import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DatabaseUnavailableError } from "../../src/database/database-unavailable-error.ts";
import { DatabaseUrl } from "../../src/database/database-url.ts";
import { runMigrations } from "../../src/database/run-migrations.ts";
import { InstanceDatabase } from "../../src/instance/instance-database.ts";
import { PendingMigrationsError } from "../../src/instance/pending-migrations-error.ts";
import { engineUnderTest } from "../support/database-engine.ts";
import { RecordingLogger } from "../support/recording-logger.ts";

const engine = engineUnderTest();

/** Runs a test on the database of an instance assembled on a database of its own, removed afterwards. */
async function onFresh(test: (instance: InstanceDatabase, logger: RecordingLogger, url: DatabaseUrl) => Promise<void>): Promise<void> {
  const fresh = await engine.create();
  const url = DatabaseUrl.parse(fresh.url) as DatabaseUrl;
  const logger = new RecordingLogger();
  const instance = new InstanceDatabase(url, logger);
  try {
    await test(instance, logger, url);
  } finally {
    await instance.close();
    await fresh.drop();
  }
}

describe("the database of an instance, assembled for a process", () => {
  it("has its schema brought in order as the database asks: a file of this machine by whichever process prepares it, a server by the migration command alone", () =>
    onFresh(async (instance, logger, url) => {
      if (instance.database.local) {
        await instance.prepare();
        assert.deepEqual(logger.lines, ["log The database is reachable and its schema is up to date."]);
      } else {
        await assert.rejects(instance.prepare(), (error) => error instanceof PendingMigrationsError && error.pending === 12);
        assert.deepEqual(logger.lines, ["warn The database schema is not up to date: migrations are pending."]);
        await runMigrations(url, new RecordingLogger());
        await instance.prepare();
      }
      assert.deepEqual(await instance.status.check(), { check: "up" });
      const asked = await instance.sessions.ask({ request: "cover the profile" }, "host");
      // Another process on the same database finds the schema in order, and what the first wrote.
      const other = new InstanceDatabase(url, new RecordingLogger());
      try {
        await other.prepare();
        assert.deepEqual(await other.sessions.sessions(), [asked]);
      } finally {
        await other.close();
      }
    }));

  it("opens nothing until it is prepared, and gives the parts a process is made of on one connection", () =>
    onFresh(async (instance) => {
      assert.equal(instance.database.local, engine.name === "sqlite");
      assert.equal(await instance.migrations.pending(), 12);
    }));
});

describe("the database of an instance that cannot be reached", () => {
  it("is not refused when it is a server: the check reports it, and the next reading raises it", async () => {
    const logger = new RecordingLogger();
    const instance = new InstanceDatabase(DatabaseUrl.parse("postgres://oqas@127.0.0.1:1/oqas") as DatabaseUrl, logger);
    try {
      await instance.prepare();
      assert.equal(logger.lines.length, 1);
      assert.match(String(logger.lines[0]), /^warn The database is unreachable: /);
      await assert.rejects(instance.sessions.sessions(), DatabaseUnavailableError);
    } finally {
      await instance.close();
    }
  });
});
