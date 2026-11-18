import assert from "node:assert/strict";
import { closedPort } from "@open-qa-stack/testing";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, it } from "vitest";
import { Database } from "../../src/database/database.ts";
import { DatabaseStatus } from "../../src/database/database-status.ts";
import { DatabaseUnavailableError } from "../../src/database/database-unavailable-error.ts";
import { DatabaseUrl } from "../../src/database/database-url.ts";
import { runMigrations } from "../../src/database/run-migrations.ts";
import { SchemaMigrations } from "../../src/database/schema-migrations.ts";
import { SessionStore } from "../../src/sessions/session-store.ts";
import { eventually } from "../support/eventually.ts";
import { FIXTURE_MIGRATIONS } from "../support/fixture-migrations.ts";
import { acceptConnections, isolatedDatabase, refuseConnections } from "../support/isolated-database.ts";
import { RecordingLogger } from "../support/recording-logger.ts";
import type { TestDatabase } from "../support/test-database.ts";

/** What names the process the tests host their sessions as. */
const HOST = "host-under-test";

const urlOf = (raw: string) => DatabaseUrl.parse(raw) as DatabaseUrl;
const DROPPED = "warn The database is unreachable: terminating connection due to administrator command";
const WITNESS = "witness-5c0ffee1";

/** The URL of a server nothing listens for, with a password no message may show. */
const absent = async (): Promise<string> => `postgres://oqas:${WITNESS}@127.0.0.1:${await closedPort()}/oqas`;

/** Asserts that an error says the database is unreachable because nothing listens, without its URL nor its password. */
function unreachable(error: unknown): true {
  assert.ok(error instanceof DatabaseUnavailableError);
  assert.equal(error.name, "DatabaseUnavailableError");
  assert.match(error.message, /^The database is unreachable: .*ECONNREFUSED/);
  assert.ok(!error.message.includes(WITNESS));
  return true;
}

let isolated: TestDatabase;
beforeAll(async () => {
  isolated = await isolatedDatabase();
});
afterAll(() => isolated.drop());

describe("the pool of connections to a PostgreSQL server", () => {
  it("lends one connection to a statement, and takes it back", async () => {
    const database = new Database(urlOf(isolated.url), new RecordingLogger());
    try {
      const pids = new Set<number>();
      for (let turn = 0; turn < 3; turn += 1) {
        const { rows } = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(database.kysely);
        pids.add((rows[0] as { pid: number }).pid);
      }
      assert.equal(pids.size, 1);
    } finally {
      await database.close();
    }
  });

  it("says that the database is unreachable when no connection can be opened, without its URL nor its password", async () => {
    const database = new Database(urlOf(await absent()), new RecordingLogger());
    await assert.rejects(sql`select 1`.execute(database.kysely), unreachable);
    await assert.rejects(new SessionStore(database).sessions(), unreachable);
    await assert.rejects(new SessionStore(database).ask({ request: "cover the profile" }, HOST), unreachable);
    await database.close();
  });

  it("names the refusal by its code when every address of a name refuses, which leaves the client without a message", async () => {
    const database = new Database(urlOf(`postgres://oqas@localhost:${await closedPort()}/oqas`), new RecordingLogger());
    await assert.rejects(sql`select 1`.execute(database.kysely), { message: "The database is unreachable: ECONNREFUSED" });
    await database.close();
  });

  it("reports a connection that drops while it is idle", async () => {
    const own = await isolatedDatabase();
    const logger = new RecordingLogger();
    const database = new Database(urlOf(own.url), logger);
    try {
      await sql`select 1`.execute(database.kysely);
      await refuseConnections(own.url);
      await eventually(() => assert.deepEqual(logger.lines, [DROPPED]));
    } finally {
      await database.close();
      await own.drop();
    }
  });
});

describe("two processes that migrate the same PostgreSQL database at once", () => {
  it("apply each migration once", async () => {
    const fresh = await isolatedDatabase();
    try {
      const migrate = () => runMigrations(urlOf(fresh.url), new RecordingLogger(), FIXTURE_MIGRATIONS);
      const runs = await Promise.all([migrate(), migrate()]);
      assert.deepEqual(runs.sort(), ["Applied 2 migrations.", "The database schema is up to date: no migration to apply."]);
    } finally {
      await fresh.drop();
    }
  });
});

describe("a series of migrations applied to a PostgreSQL database", () => {
  it("is applied whole or not at all: a migration that fails undoes those applied before it in the same run", async () => {
    const fresh = await isolatedDatabase();
    const database = new Database(urlOf(fresh.url), new RecordingLogger());
    try {
      const broken = {
        ...FIXTURE_MIGRATIONS,
        "0003_broken": { up: async (schema: Kysely<unknown>) => void (await sql`select * from missing_table`.execute(schema)) },
      };
      await assert.rejects(runMigrations(urlOf(fresh.url), new RecordingLogger(), broken), /missing_table/);
      assert.deepEqual((await database.kysely.introspection.getTables()).length, 0);
      assert.equal(await new SchemaMigrations(database, broken).pending(), 3);
    } finally {
      await database.close();
      await fresh.drop();
    }
  });
});

describe("the migrations of a PostgreSQL server that cannot be reached", () => {
  it("are neither applied nor counted, which is said without its URL nor its password", async () => {
    const url = urlOf(await absent());
    await assert.rejects(runMigrations(url, new RecordingLogger()), unreachable);
    const database = new Database(url, new RecordingLogger());
    await assert.rejects(new SchemaMigrations(database).pending(), unreachable);
    await database.close();
  });
});

describe("the status of a PostgreSQL database", () => {
  it("tells that the database is unreachable while it refuses connections, and that it is up once it accepts them again", async () => {
    const fresh = await isolatedDatabase();
    const logger = new RecordingLogger();
    const database = new Database(urlOf(fresh.url), new RecordingLogger());
    try {
      const migrations = new SchemaMigrations(database, FIXTURE_MIGRATIONS);
      await migrations.apply();
      const status = new DatabaseStatus(migrations, logger);
      await refuseConnections(fresh.url);
      assert.deepEqual(await status.check(), { check: "unreachable" });
      assert.deepEqual(await status.check(), { check: "unreachable" });
      await acceptConnections(fresh.url);
      assert.deepEqual(await status.check(), { check: "up" });
      assert.equal(logger.lines.length, 2, logger.lines.join("\n"));
      assert.match(String(logger.lines[0]), /^warn The database is unreachable: .*not currently accepting connections/);
      assert.equal(logger.lines[1], "log The database is reachable and its schema is up to date.");
    } finally {
      await database.close();
      await fresh.drop();
    }
  });
});
