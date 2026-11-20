import assert from "node:assert/strict";
import { sql } from "kysely";
import { describe, it } from "vitest";
import { Database } from "../../src/database/database.ts";
import { DatabaseStatus } from "../../src/database/database-status.ts";
import { DatabaseUrl } from "../../src/database/database-url.ts";
import { MIGRATIONS } from "../../src/database/migrations/index.ts";
import { runMigrations } from "../../src/database/run-migrations.ts";
import { SchemaMigrations } from "../../src/database/schema-migrations.ts";
import { engineUnderTest } from "../support/database-engine.ts";
import { FIXTURE_MIGRATIONS, firstFixtureMigrations } from "../support/fixture-migrations.ts";
import { RecordingLogger } from "../support/recording-logger.ts";
import type { Migration } from "kysely/migration";

const engine = engineUnderTest();
const urlOf = (raw: string) => DatabaseUrl.parse(raw) as DatabaseUrl;

/** Applies the pending migrations of a series to a database. */
const migrate = (url: string, migrations?: Readonly<Record<string, Migration>>) => runMigrations(urlOf(url), new RecordingLogger(), migrations);

/** The tables of a database, those that record its migrations included. */
async function tables(database: Database): Promise<string[]> {
  const found = await database.kysely.introspection.getTables({ withInternalKyselyTables: true });
  return found.map(({ name }) => name).sort();
}

/** Runs a test on a database of its own, removed afterwards. */
async function onFresh(test: (database: Database, url: string) => Promise<void>): Promise<void> {
  const fresh = await engine.create();
  const database = new Database(urlOf(fresh.url), new RecordingLogger());
  try {
    await test(database, fresh.url);
  } finally {
    await database.close();
    await fresh.drop();
  }
}

describe("applying the migrations", () => {
  it("creates the schema on an empty database, then changes nothing and says so", () =>
    onFresh(async (database, url) => {
      assert.equal(await migrate(url, FIXTURE_MIGRATIONS), "Applied 2 migrations.");
      const created = await tables(database);
      assert.deepEqual(created, ["fixture_items", "fixture_notes", "kysely_migration", "kysely_migration_lock"]);
      assert.equal(await migrate(url, FIXTURE_MIGRATIONS), "The database schema is up to date: no migration to apply.");
      assert.deepEqual(await tables(database), created);
    }));

  it("applies the versioned migrations of the package when no series is named", () =>
    onFresh(async (database, url) => {
      assert.deepEqual(Object.keys(MIGRATIONS), [
        "0001_sessions",
        "0002_session_hosts",
        "0003_configuration_revisions",
        "0004_knowledge_documents",
        "0005_executions",
        "0006_execution_failures",
      ]);
      assert.equal(await migrate(url), "Applied 6 migrations.");
      assert.deepEqual(await tables(database), [
        "configuration_revisions",
        "execution_results",
        "executions",
        "knowledge_documents",
        "kysely_migration",
        "kysely_migration_lock",
        "project",
        "session_events",
        "session_messages",
        "sessions",
      ]);
      assert.equal(await migrate(url), "The database schema is up to date: no migration to apply.");
    }));

  it("applies only the migrations added since the last run", () =>
    onFresh(async (_database, url) => {
      assert.equal(await migrate(url, firstFixtureMigrations(1)), "Applied 1 migration.");
      assert.equal(await migrate(url, FIXTURE_MIGRATIONS), "Applied 1 migration.");
    }));

  it("raises the error of a migration that fails, and leaves it pending", () =>
    onFresh(async (database, url) => {
      const broken: Record<string, Migration> = {
        ...FIXTURE_MIGRATIONS,
        "0003_broken": { up: async (schema) => void (await sql`select * from missing_table`.execute(schema)) },
      };
      await assert.rejects(migrate(url, broken), /missing_table/);
      // PostgreSQL undid the two applied before it in the same run; SQLite kept them, each recorded in turn.
      assert.equal(await new SchemaMigrations(database, broken).pending(), engine.name === "postgres" ? 3 : 1);
    }));
});

describe("pending migrations", () => {
  it("are counted from the record the database keeps of those it applied", () =>
    onFresh(async (database) => {
      const migrations = new SchemaMigrations(database, FIXTURE_MIGRATIONS);
      assert.equal(await migrations.pending(), 2);
      assert.equal(await new SchemaMigrations(database, firstFixtureMigrations(1)).apply(), 1);
      assert.equal(await migrations.pending(), 1);
      assert.equal(await migrations.apply(), 1);
      assert.equal(await migrations.pending(), 0);
      assert.equal(await migrations.apply(), 0);
    }));

  it("are all pending on a record that holds none", () =>
    onFresh(async (database) => {
      assert.equal(await new SchemaMigrations(database, firstFixtureMigrations(0)).apply(), 0);
      assert.equal(await new SchemaMigrations(database, FIXTURE_MIGRATIONS).pending(), 2);
    }));

  it("cannot be counted when the record of the database cannot be read", () =>
    onFresh(async (database) => {
      await database.kysely.schema.createTable("kysely_migration").addColumn("id", "integer").execute();
      const migrations = new SchemaMigrations(database, FIXTURE_MIGRATIONS);
      await assert.rejects(migrations.pending(), /name/);
      await assert.rejects(new DatabaseStatus(migrations, new RecordingLogger()).check(), /name/);
    }));
});

describe("the status of the database", () => {
  it("tells that migrations are pending, then that the database is up, and logs each change once", () =>
    onFresh(async (database) => {
      const logger = new RecordingLogger();
      const migrations = new SchemaMigrations(database, FIXTURE_MIGRATIONS);
      const status = new DatabaseStatus(migrations, logger);
      assert.deepEqual(await status.check(), { check: "migrations_pending", pending: 2 });
      assert.deepEqual(await status.check(), { check: "migrations_pending", pending: 2 });
      await migrations.apply();
      assert.deepEqual(await status.check(), { check: "up" });
      assert.deepEqual(await status.check(), { check: "up" });
      assert.deepEqual(logger.lines, [
        "warn The database schema is not up to date: migrations are pending.",
        "log The database is reachable and its schema is up to date.",
      ]);
    }));
});
