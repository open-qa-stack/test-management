import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, it } from "vitest";
import { Database } from "../src/database/database.ts";
import { DatabaseUrl } from "../src/database/database-url.ts";
import { SchemaMigrations } from "../src/database/schema-migrations.ts";
import { SessionStore } from "../src/sessions/session-store.ts";
import { RecordingLogger } from "./support/recording-logger.ts";

const run = promisify(execFile);
const SECOND_PROCESS = fileURLToPath(new URL("sqlite/second-process.ts", import.meta.url));

/** How many writes each of the two processes makes to the same session. */
const WRITES = 40;

let folder: string;
let database: Database;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "oqas-two-processes-"));
});
afterEach(async () => {
  await database.close();
  rmSync(folder, { recursive: true, force: true });
});

describe("two processes on the SQLite file of an instance", () => {
  it("write to the same session at the same time: none fails, each event has a rank of its own and each message a number of its own", async () => {
    const file = join(folder, "oqas.db");
    database = new Database(DatabaseUrl.ofFile(file), new RecordingLogger());
    await new SchemaMigrations(database).apply();
    const store = new SessionStore(database);
    const { id } = await store.start((await store.ask({ request: "cover the profile" }, "host")).id, "host");
    const second = run(process.execPath, [SECOND_PROCESS, file, id, String(WRITES)]);
    for (let told = 0; told < WRITES; told += 1) {
      await store.append(id, [{ at: "2026-11-14T09:00:00.000Z", type: "note", phase: "plan", text: `from the first process, ${told}` }]);
      await store.beat("host");
    }
    const numbers = JSON.parse((await second).stdout) as number[];
    assert.deepEqual(
      numbers,
      Array.from({ length: WRITES }, (_, index) => index + 1),
    );
    const events = await store.eventsAfter(id, 0);
    assert.deepEqual(
      events.map((event) => event.id),
      events.map((_, index) => index + 1),
    );
    assert.equal(events.filter((event) => event.type === "note").length, WRITES);
    assert.equal(events.filter((event) => event.type === "user_message").length, WRITES + 1);
    assert.equal((await store.pendingMessages(id)).length, WRITES);
  });
});
