import assert from "node:assert/strict";
import { sql } from "kysely";
import { describe, it } from "vitest";
import { Database } from "../../src/database/database.ts";
import { DatabaseUrl } from "../../src/database/database-url.ts";
import { engineUnderTest } from "../support/database-engine.ts";
import { RecordingLogger } from "../support/recording-logger.ts";

const engine = engineUnderTest();

describe("the database of an instance", () => {
  it("runs the same statements whichever database its URL names, and tells whether it is a file of this machine", async () => {
    const own = await engine.create();
    const database = new Database(DatabaseUrl.parse(own.url) as DatabaseUrl, new RecordingLogger());
    try {
      assert.equal(database.local, engine.name === "sqlite");
      const { rows } = await sql<{ one: number }>`select 1 as one`.execute(database.kysely);
      assert.deepEqual(
        rows.map(({ one }) => one),
        [1],
      );
      await assert.rejects(sql`select * from missing_table`.execute(database.kysely), /missing_table/);
      assert.deepEqual(
        (await sql<{ two: number }>`select 2 as two`.execute(database.kysely)).rows.map(({ two }) => two),
        [2],
      );
    } finally {
      await database.close();
      await own.drop();
    }
  });

  it("is closed without having been opened", async () => {
    const own = await engine.create();
    try {
      await new Database(DatabaseUrl.parse(own.url) as DatabaseUrl, new RecordingLogger()).close();
    } finally {
      await own.drop();
    }
  });
});
