import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { TEST_ENVIRONMENT } from "../support/environment.ts";
import { isolatedDatabase } from "../support/isolated-database.ts";

/**
 * Writes a row in a database of its own, waits until the other probe has written its own, then reads:
 * it must find its row only.
 */
export function probeIsolation(self: string, other: string): void {
  it(`sees the data of ${self} only`, async () => {
    const meeting = TEST_ENVIRONMENT["OQAS_ISOLATION_MEETING"] as string;
    const database = await isolatedDatabase();
    const client = new pg.Client({ connectionString: database.url });
    await client.connect();
    try {
      await client.query("create table probe (owner text not null)");
      await client.query("insert into probe values ($1)", [self]);
      writeFileSync(join(meeting, self), "");
      for (let waited = 0; !existsSync(join(meeting, other)); waited += 50) {
        assert.ok(waited < 30_000, `${other} never wrote its row: the two probes did not run together`);
        await delay(50);
      }
      const { rows } = await client.query<{ owner: string }>("select owner from probe");
      assert.deepEqual(rows, [{ owner: self }]);
    } finally {
      await client.end();
      await database.drop();
    }
  });
}
