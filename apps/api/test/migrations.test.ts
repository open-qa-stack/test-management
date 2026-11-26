import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { fileURLToPath } from "node:url";
import { Database, DatabaseStatus, DatabaseUrl, InstanceDatabase, PendingMigrationsError, SchemaMigrations } from "@open-qa-stack/store";
import { FIXTURE_MIGRATIONS, firstFixtureMigrations, POSTGRES, SQLITE } from "@open-qa-stack/store/testing";
import { closedPort } from "@open-qa-stack/testing";
import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module.ts";
import { layOut } from "../src/api-layout.ts";
import { ApiConfiguration } from "../src/config/api-configuration.ts";
import { HealthService } from "../src/health/health.service.ts";
import { apiFrom } from "./support/started-api.ts";
import { CapturedLogger } from "./support/captured-logger.ts";
import { childEnvironment } from "./support/environment.ts";

const MIGRATE = fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url));

/** The tables of an instance, with those that record its migrations. */
const TABLES = [
  "campaign_tests",
  "campaigns",
  "configuration_revisions",
  "domain_settings",
  "execution_results",
  "executions",
  "knowledge_documents",
  "kysely_migration",
  "kysely_migration_lock",
  "memories",
  "project",
  "session_events",
  "session_messages",
  "sessions",
  "test_decisions",
  "test_versions",
  "tests",
];

/** Runs a program of the package with the given variables only. */
function program(path: string, variables: Record<string, string>): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) =>
    execFile(process.execPath, ["--enable-source-maps", path], { env: childEnvironment(variables), encoding: "utf8", timeout: 20_000 }, (error, out, err) =>
      resolve({ code: error === null ? 0 : (error.code as number), out, err }),
    ),
  );
}

/** A database, which logs where the API logs what happens to its database. */
function databaseOf(url: string): Database {
  return new Database(DatabaseUrl.parse(url) as DatabaseUrl, new Logger("Database"));
}

/** The tables of a database, those that record its migrations included. */
async function tables(url: string): Promise<string[]> {
  const database = databaseOf(url);
  try {
    const found = await database.kysely.introspection.getTables({ withInternalKyselyTables: true });
    return found.map(({ name }) => name).sort();
  } finally {
    await database.close();
  }
}

/** Starts an API whose versioned migrations are those of the fixture, on a port nothing listens on yet. */
async function fixtureApi(url: string): Promise<{ app: NestFastifyApplication; port: number }> {
  const port = await closedPort();
  const configuration = ApiConfiguration.read({ OQAS_PORT: String(port), OQAS_DATABASE_URL: url });
  const module = await Test.createTestingModule({ imports: [AppModule.forRoot(configuration)] })
    .overrideProvider(InstanceDatabase)
    .useValue(new InstanceDatabase(configuration.database, new Logger("Database"), FIXTURE_MIGRATIONS))
    .compile();
  const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
  await layOut(app, configuration.console);
  return { app, port };
}

describe("the migration command", () => {
  for (const engine of [SQLITE, POSTGRES]) {
    it(`applies the versioned migrations of the instance, then changes nothing and says so, on ${engine.name}`, async () => {
      const fresh = await engine.create();
      try {
        const first = await program(MIGRATE, { OQAS_DATABASE_URL: fresh.url });
        assert.deepEqual(first, { code: 0, out: "Applied 17 migrations.\n", err: "" });
        assert.deepEqual(await tables(fresh.url), TABLES);
        const second = await program(MIGRATE, { OQAS_DATABASE_URL: fresh.url });
        assert.deepEqual(second, { code: 0, out: "The database schema is up to date: no migration to apply.\n", err: "" });
        assert.deepEqual(await tables(fresh.url), TABLES);
      } finally {
        await fresh.drop();
      }
    });
  }

  it("migrates the file in the state folder of the test repository when it is given no URL", async () => {
    const repository = mkdtempSync(join(tmpdir(), "oqas-api-migrate-"));
    try {
      writeFileSync(join(repository, "oqas.json"), "{}");
      assert.deepEqual(await program(MIGRATE, { OQAS_REPOSITORY: repository }), { code: 0, out: "Applied 17 migrations.\n", err: "" });
      assert.deepEqual(await tables(`sqlite:${join(repository, ".oqas", "oqas.db")}`), TABLES);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("fails with a message when it is given neither a URL nor a test repository, or when the database cannot be reached", async () => {
    const missing = await program(MIGRATE, {});
    assert.deepEqual(missing, {
      code: 1,
      out: "",
      err: "The configuration is invalid:\n- OQAS_DATABASE_URL or OQAS_REPOSITORY must be set, and neither is.\n",
    });
    const url = `postgres://oqas:witness-5c0ffee1@127.0.0.1:${await closedPort()}/oqas`;
    const unreachable = await program(MIGRATE, { OQAS_DATABASE_URL: url });
    assert.equal(unreachable.code, 1);
    assert.match(unreachable.err, /^The database is unreachable: .*ECONNREFUSED/);
    assert.ok(!unreachable.err.includes("witness-5c0ffee1") && !unreachable.out.includes("witness-5c0ffee1"));
    const everyAddress = await program(MIGRATE, { OQAS_DATABASE_URL: `postgres://oqas@localhost:${await closedPort()}/oqas` });
    assert.deepEqual(everyAddress, { code: 1, out: "", err: "The database is unreachable: ECONNREFUSED\n" });
  });
});

describe("pending migrations", () => {
  it("make the instance not ready, which is logged once", async () => {
    const fresh = await POSTGRES.create();
    const db = databaseOf(fresh.url);
    const logger = new CapturedLogger();
    Logger.overrideLogger(logger);
    try {
      const health = new HealthService(new DatabaseStatus(new SchemaMigrations(db, FIXTURE_MIGRATIONS), new Logger("Database")));
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

  it("stop the startup of an API whose database is on a server, with a message that says so, before it listens", async () => {
    const fresh = await POSTGRES.create();
    const db = databaseOf(fresh.url);
    try {
      await new SchemaMigrations(db, firstFixtureMigrations(1)).apply();
      const { app, port } = await fixtureApi(fresh.url);
      await assert.rejects(app.listen(port, "127.0.0.1"), {
        name: "PendingMigrationsError",
        pending: 1,
        message: "The database schema is not up to date: 1 migration is pending. Apply them with the migration command, then start again.",
      });
      await app.close();
      await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`));
      assert.equal(
        new PendingMigrationsError(2).message,
        "The database schema is not up to date: 2 migrations are pending. Apply them with the migration command, then start again.",
      );
    } finally {
      await fresh.drop();
    }
  });

  it("are applied by an API whose database is a file of its machine, when it starts: it has the file to itself", async () => {
    const fresh = await SQLITE.create();
    const db = databaseOf(fresh.url);
    try {
      await new SchemaMigrations(db, firstFixtureMigrations(1)).apply();
      const { app, port } = await fixtureApi(fresh.url);
      await app.listen(port, "127.0.0.1");
      try {
        const ready = await fetch(`http://127.0.0.1:${port}/api/health/ready`);
        assert.deepEqual([ready.status, await ready.json()], [200, { status: "ready", checks: { database: "up" } }]);
        assert.equal(await new SchemaMigrations(db, FIXTURE_MIGRATIONS).pending(), 0);
      } finally {
        await app.close();
      }
    } finally {
      await fresh.drop();
    }
  });

  it("cannot be counted when the record of the database cannot be read, which stops the startup and fails the readiness", async () => {
    const fresh = await POSTGRES.create();
    const db = databaseOf(fresh.url);
    try {
      await db.kysely.schema.createTable("kysely_migration").addColumn("id", "integer").execute();
      const status = new DatabaseStatus(new SchemaMigrations(db, FIXTURE_MIGRATIONS), new Logger("Database"));
      await assert.rejects(new HealthService(status).readiness(), /column "name" does not exist/);
      const migrate = await program(MIGRATE, { OQAS_DATABASE_URL: fresh.url });
      assert.equal(migrate.code, 1);
      assert.match(migrate.err, /column "name"/);
      const port = await closedPort();
      await assert.rejects(apiFrom({ OQAS_HOST: "127.0.0.1", OQAS_PORT: String(port), OQAS_DATABASE_URL: fresh.url }), /column "name" does not exist/);
    } finally {
      await db.close();
      await fresh.drop();
    }
  });
});

describe("the file of a database that cannot be opened", () => {
  it("stops the startup of the API with a message that names it, before it listens", async () => {
    const folder = mkdtempSync(join(tmpdir(), "oqas-api-unopenable-"));
    try {
      // A file stands where the folder of the database should be.
      writeFileSync(join(folder, "state"), "");
      const file = join(folder, "state", "oqas.db");
      const main = fileURLToPath(new URL("../dist/src/main.js", import.meta.url));
      const run = await program(main, { OQAS_HOST: "127.0.0.1", OQAS_PORT: String(await closedPort()), OQAS_DATABASE_URL: `sqlite:${file}` });
      assert.equal(run.code, 1);
      assert.match(run.err, /^The database is unreachable: .*oqas\.db cannot be opened \(.+\)\.\n$/);
      assert.ok(run.err.includes(file) && !existsSync(file));
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
