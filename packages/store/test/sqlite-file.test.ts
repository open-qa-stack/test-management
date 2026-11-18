import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, it } from "vitest";
import { Database } from "../src/database/database.ts";
import { DatabaseUnavailableError } from "../src/database/database-unavailable-error.ts";
import { DatabaseUrl } from "../src/database/database-url.ts";
import { SchemaMigrations } from "../src/database/schema-migrations.ts";
import { SessionStore } from "../src/sessions/session-store.ts";
import { RecordingLogger } from "./support/recording-logger.ts";

let folder: string;
/** The databases a test opened, closed after it. */
let opened: Database[];
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "oqas-sqlite-file-"));
  opened = [];
});
afterEach(async () => {
  for (const one of opened) await one.close();
  rmSync(folder, { recursive: true, force: true });
});

/** Opens the database a URL names, with the schema of an instance when asked to. */
async function open(url: DatabaseUrl, migrate = true): Promise<Database> {
  const database = new Database(url, new RecordingLogger());
  opened.push(database);
  if (migrate) await new SchemaMigrations(database).apply();
  return database;
}

describe("a database that is a SQLite file", () => {
  it("is kept in a folder made when needed, with a write-ahead log, and holds what was written when the file is opened again", async () => {
    const file = join(folder, "state", "deeper", "oqas.db");
    const first = await open(DatabaseUrl.ofFile(file));
    const asked = await new SessionStore(first).ask({ request: "cover the profile" });
    assert.deepEqual(
      (await sql<{ journal_mode: string }>`pragma journal_mode`.execute(first.kysely)).rows.map((row) => row.journal_mode),
      ["wal"],
    );
    await first.close();
    assert.ok(existsSync(file));
    const second = await open(DatabaseUrl.ofFile(file), false);
    assert.deepEqual(await new SessionStore(second).sessions(), [asked]);
  });

  it("is kept in memory when its URL says so", async () => {
    const database = await open(DatabaseUrl.parse("sqlite::memory:") as DatabaseUrl);
    assert.equal(database.local, true);
    assert.deepEqual(await new SessionStore(database).sessions(), []);
  });

  it("lends its one connection to one transaction at a time: what is read meanwhile waits, and never falls in the middle of one", async () => {
    const { kysely } = await open(DatabaseUrl.parse("sqlite::memory:") as DatabaseUrl);
    const at = "2026-11-14T09:00:00.000Z";
    const seen: number[] = [];
    const count = async (): Promise<void> => {
      seen.push((await kysely.selectFrom("sessions").select("id").execute()).length);
    };
    const writeTwo = (pair: number) =>
      kysely.transaction().execute(async (transaction) => {
        await transaction
          .insertInto("sessions")
          .values({ id: `${pair}-first`, opened_at: at, last_event_at: at, state: "queued" })
          .execute();
        // Long enough for every other statement to be asked for while this transaction is open.
        await pause(5);
        await transaction
          .insertInto("sessions")
          .values({ id: `${pair}-second`, opened_at: at, last_event_at: at, state: "queued" })
          .execute();
      });
    await Promise.all(Array.from({ length: 10 }, (_, pair) => [writeTwo(pair), count()]).flat());
    assert.equal(seen.length, 10);
    assert.deepEqual(
      seen.filter((rows) => rows % 2 === 1),
      [],
      "a reading saw half of a transaction",
    );
  });
});

describe("a SQLite file that cannot be opened", () => {
  it("makes the database unavailable, which names the file, until it can be opened", async () => {
    // A file stands where the folder of the database should be.
    writeFileSync(join(folder, "state"), "");
    const file = join(folder, "state", "oqas.db");
    const database = await open(DatabaseUrl.ofFile(file), false);
    const reading = () => sql`select 1 as one`.execute(database.kysely);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(reading(), (error) => {
        assert.ok(error instanceof DatabaseUnavailableError);
        assert.match(error.message, /^The database is unreachable: .*oqas\.db cannot be opened \(.+\)\.$/);
        assert.ok(error.message.includes(file));
        return true;
      });
    }
    rmSync(join(folder, "state"));
    assert.equal((await reading()).rows.length, 1);
  });
});
