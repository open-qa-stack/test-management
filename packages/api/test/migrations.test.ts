import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { closedPort } from "@open-qa-stack/testing";
import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import pg from "pg";
import { AppModule } from "../src/app.module.ts";
import { ApiConfiguration } from "../src/config/api-configuration.ts";
import { DatabaseUrl } from "../src/config/database-url.ts";
import { Database } from "../src/database/database.ts";
import { DatabaseStatus } from "../src/database/database-status.ts";
import { MIGRATIONS_FOLDER } from "../src/database/migrations-folder.ts";
import { PendingMigrationsError } from "../src/database/pending-migrations-error.ts";
import { runMigrations } from "../src/database/run-migrations.ts";
import { SchemaMigrations } from "../src/database/schema-migrations.ts";
import { HealthService } from "../src/health/health.service.ts";
import { startApi } from "../src/start-api.ts";
import { CapturedLogger } from "./support/captured-logger.ts";
import { childEnvironment } from "./support/environment.ts";
import { isolatedDatabase, type IsolatedDatabase } from "./support/isolated-database.ts";

const MIGRATE = fileURLToPath(new URL("../src/migrate.js", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../test/fixtures/migrations", import.meta.url));

/** Runs a program of the package with the given variables only. */
function program(path: string, variables: Record<string, string>): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) =>
    execFile(process.execPath, ["--enable-source-maps", path], { env: childEnvironment(variables), encoding: "utf8", timeout: 20_000 }, (error, out, err) =>
      resolve({ code: error === null ? 0 : (error.code as number), out, err }),
    ),
  );
}

/** A copy of the fixture migrations whose journal keeps only the first ones. */
function firstFixtureMigrations(count: number): string {
  const folder = mkdtempSync(join(tmpdir(), "oqas-fixture-migrations-"));
  cpSync(FIXTURE, folder, { recursive: true });
  const journal = {
    version: "7",
    dialect: "postgresql",
    entries: [
      { idx: 0, version: "7", when: 1000, tag: "0000_items", breakpoints: true },
      { idx: 1, version: "7", when: 2000, tag: "0001_notes", breakpoints: true },
    ].slice(0, count),
  };
  writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify(journal));
  return folder;
}

async function tables(url: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ name: string }>(
      "select format('%I.%I', schemaname, tablename) as name from pg_tables where schemaname not in ('pg_catalog', 'information_schema') order by 1",
    );
    return rows.map((row) => row.name);
  } finally {
    await client.end();
  }
}

function urlOf(raw: string): DatabaseUrl {
  const url = DatabaseUrl.parse(raw);
  assert.ok(url !== undefined);
  return url;
}

describe("the migration command", () => {
  let database: IsolatedDatabase;
  before(async () => {
    database = await isolatedDatabase();
  });
  after(() => database.drop());

  it("creates the schema on an empty database, then changes nothing and says so", async () => {
    const env = { OQAS_DATABASE_URL: database.url };
    assert.equal(await runMigrations(env, FIXTURE), "Applied 2 migrations.");
    const created = await tables(database.url);
    assert.deepEqual(created, ["drizzle.__drizzle_migrations", "public.fixture_items", "public.fixture_notes"]);
    assert.equal(await runMigrations(env, FIXTURE), "The database schema is up to date: no migration to apply.");
    assert.deepEqual(await tables(database.url), created);
  });

  it("applies the versioned migrations of the API, twice without a change", async () => {
    const fresh = await isolatedDatabase();
    try {
      const first = await program(MIGRATE, { OQAS_DATABASE_URL: fresh.url });
      assert.equal(first.code, 0, first.err);
      const created = await tables(fresh.url);
      assert.ok(created.includes("drizzle.__drizzle_migrations"));
      const second = await program(MIGRATE, { OQAS_DATABASE_URL: fresh.url });
      assert.deepEqual(second, { code: 0, out: "The database schema is up to date: no migration to apply.\n", err: "" });
      assert.deepEqual(await tables(fresh.url), created);
    } finally {
      await fresh.drop();
    }
  });

  it("applies only the migrations added since the last run", async () => {
    const fresh = await isolatedDatabase();
    const first = firstFixtureMigrations(1);
    try {
      assert.equal(await runMigrations({ OQAS_DATABASE_URL: fresh.url }, first), "Applied 1 migration.");
      assert.equal(await runMigrations({ OQAS_DATABASE_URL: fresh.url }, FIXTURE), "Applied 1 migration.");
    } finally {
      rmSync(first, { recursive: true, force: true });
      await fresh.drop();
    }
  });

  it("applies each migration once when two runs start together", async () => {
    const fresh = await isolatedDatabase();
    try {
      const runs = await Promise.all([runMigrations({ OQAS_DATABASE_URL: fresh.url }, FIXTURE), runMigrations({ OQAS_DATABASE_URL: fresh.url }, FIXTURE)]);
      assert.deepEqual(runs.sort(), ["Applied 2 migrations.", "The database schema is up to date: no migration to apply."]);
    } finally {
      await fresh.drop();
    }
  });

  it("fails with a message when the variable is missing or the database cannot be reached", async () => {
    const missing = await program(MIGRATE, {});
    assert.deepEqual(missing, { code: 1, out: "", err: "The configuration is invalid:\n- OQAS_DATABASE_URL is required and is not set.\n" });
    const url = `postgres://oqas:witness-5c0ffee1@127.0.0.1:${await closedPort()}/oqas`;
    const unreachable = await program(MIGRATE, { OQAS_DATABASE_URL: url });
    assert.equal(unreachable.code, 1);
    assert.match(unreachable.err, /^The database is unreachable: .*ECONNREFUSED/);
    assert.ok(!unreachable.err.includes("witness-5c0ffee1") && !unreachable.out.includes("witness-5c0ffee1"));
    const everyAddress = await program(MIGRATE, { OQAS_DATABASE_URL: `postgres://oqas@localhost:${await closedPort()}/oqas` });
    assert.deepEqual(everyAddress, { code: 1, out: "", err: "The database is unreachable: ECONNREFUSED\n" });
  });

  it("lets an error reported by the server through, the transaction rolled back", async () => {
    const fresh = await isolatedDatabase();
    const broken = firstFixtureMigrations(2);
    writeFileSync(
      join(broken, "0001_notes.sql"),
      'CREATE TABLE "fixture_notes" ("id" integer PRIMARY KEY);\n--> statement-breakpoint\nSELECT * FROM "missing_table";',
    );
    try {
      await assert.rejects(
        runMigrations({ OQAS_DATABASE_URL: fresh.url }, broken),
        (error: Error) => error.cause instanceof pg.DatabaseError && /missing_table/.test(error.cause.message),
      );
      assert.deepEqual(await tables(fresh.url), ["drizzle.__drizzle_migrations"]);
    } finally {
      rmSync(broken, { recursive: true, force: true });
      await fresh.drop();
    }
  });
});

describe("the versioned migrations", () => {
  it("are read from the migrations folder of the package", () => {
    assert.equal(MIGRATIONS_FOLDER, fileURLToPath(new URL("../../migrations", import.meta.url)));
  });

  it("need a journal", () => {
    const empty = mkdtempSync(join(tmpdir(), "oqas-no-journal-"));
    try {
      assert.throws(() => new SchemaMigrations(new Database(urlOf("postgres://oqas@127.0.0.1:1/oqas")), empty), /_journal\.json/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("pending migrations", () => {
  let database: IsolatedDatabase;
  before(async () => {
    database = await isolatedDatabase();
  });
  after(() => database.drop());

  it("are counted from the journal of the database", async () => {
    const db = new Database(urlOf(database.url));
    try {
      const migrations = new SchemaMigrations(db, FIXTURE);
      assert.equal(await migrations.pending(), 2);
      const first = firstFixtureMigrations(1);
      try {
        await new SchemaMigrations(db, first).apply();
      } finally {
        rmSync(first, { recursive: true, force: true });
      }
      assert.equal(await migrations.pending(), 1);
      await migrations.apply();
      assert.equal(await migrations.pending(), 0);
    } finally {
      await db.close();
    }
  });

  it("are all pending on a journal that records none", async () => {
    const fresh = await isolatedDatabase();
    const db = new Database(urlOf(fresh.url));
    try {
      const none = firstFixtureMigrations(0);
      try {
        await new SchemaMigrations(db, none).apply();
      } finally {
        rmSync(none, { recursive: true, force: true });
      }
      assert.equal(await new SchemaMigrations(db, FIXTURE).pending(), 2);
    } finally {
      await db.close();
      await fresh.drop();
    }
  });

  it("make the instance not ready, which is logged once", async () => {
    const fresh = await isolatedDatabase();
    const db = new Database(urlOf(fresh.url));
    const logger = new CapturedLogger();
    Logger.overrideLogger(logger);
    try {
      const health = new HealthService(new DatabaseStatus(new SchemaMigrations(db, FIXTURE)));
      const notReady = { readiness: { status: "not_ready", checks: { database: "migrations_pending" } } };
      await assert.rejects(health.readiness(), notReady);
      await assert.rejects(health.readiness(), notReady);
      assert.deepEqual(logger.lines, ["warn The database schema is not up to date: migrations are pending. Database"]);
    } finally {
      Logger.overrideLogger(true);
      await db.close();
      await fresh.drop();
    }
  });

  it("stop the startup of the API with a message that says so, before it listens", async () => {
    const fresh = await isolatedDatabase();
    const first = firstFixtureMigrations(1);
    const db = new Database(urlOf(fresh.url));
    try {
      await new SchemaMigrations(db, first).apply();
      const port = await closedPort();
      const configuration = ApiConfiguration.read({ OQAS_PORT: String(port), OQAS_DATABASE_URL: fresh.url });
      const module = await Test.createTestingModule({ imports: [AppModule.forRoot(configuration)] })
        .overrideProvider(SchemaMigrations)
        .useValue(new SchemaMigrations(db, FIXTURE))
        .compile();
      const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
      await assert.rejects(app.listen(port, "127.0.0.1"), {
        name: "PendingMigrationsError",
        pending: 1,
        message: "The database schema is not up to date: 1 migration is pending. Apply them with the migration command, then start the API again.",
      });
      await app.close();
      await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
      assert.equal(
        new PendingMigrationsError(2).message,
        "The database schema is not up to date: 2 migrations are pending. Apply them with the migration command, then start the API again.",
      );
    } finally {
      rmSync(first, { recursive: true, force: true });
      await db.close();
      await fresh.drop();
    }
  });

  it("cannot be counted when the journal of the database cannot be read, which stops the startup and fails the readiness", async () => {
    const fresh = await isolatedDatabase();
    const db = new Database(urlOf(fresh.url));
    try {
      await db.withClient((client) => client.query("create schema drizzle; create table drizzle.__drizzle_migrations (id integer)"));
      await assert.rejects(new SchemaMigrations(db, FIXTURE).pending(), (error) => error instanceof pg.DatabaseError && /created_at/.test(error.message));
      await assert.rejects(new HealthService(new DatabaseStatus(new SchemaMigrations(db, FIXTURE))).readiness(), (error) => error instanceof pg.DatabaseError);
      const migrate = await program(MIGRATE, { OQAS_DATABASE_URL: fresh.url });
      assert.equal(migrate.code, 1);
      assert.match(migrate.err, /created_at/);
      const port = await closedPort();
      await assert.rejects(
        startApi({ OQAS_HOST: "127.0.0.1", OQAS_PORT: String(port), OQAS_DATABASE_URL: fresh.url }, { logger: false }),
        (error) => error instanceof pg.DatabaseError,
      );
    } finally {
      await db.close();
      await fresh.drop();
    }
  });
});
