import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { toolCalls } from "@open-qa-stack/testing";
import { DatabaseUrl, InstanceDatabase } from "@open-qa-stack/store";
import { chain, MODEL, submit, Terminal } from "../support/terminal.ts";

const BRIEF = ["--environment", "local", "--brief", "tester la liste des commandes"];

/** What an earlier version left in the state folder: the notes of its agents, in a file. */
const EARLIER_NOTES = `${JSON.stringify({ text: "Orders are listed by date.", tags: ["orders"], role: "planner", task: "t", writtenAt: "2026-11-01T00:00:00.000Z" })}\n`;

let terminal: Terminal;
afterEach(() => terminal.close());

/** What the agent that plans remembers before it reads the orders: the fact of the earlier file, which it would be shown were the file read. */
const REMEMBERED = { domain: "orders", kind: "business_rule", text: "Orders are listed by date, the latest first.", tags: ["orders"] };

/** The replies of the whole chain, the agent that plans remembering a fact first. */
function remembering() {
  const replies = chain();
  const at = replies.findIndex((reply) => JSON.stringify(reply.body).includes("order_specs_read_section"));
  replies.splice(at, 0, { body: toolCalls(MODEL, [submit("remember", REMEMBERED, "mem")]) });
  return replies;
}

/** The memories the database of the test repository keeps. */
async function memoriesOf(root: string) {
  const instance = new InstanceDatabase(DatabaseUrl.ofFile(join(root, ".oqas", "oqas.db")), { log() {}, warn() {} });
  try {
    return (await instance.memory.list({})).map(({ domain, kind, text, tags, written }) => ({ domain, kind, text, tags, role: written.role }));
  } finally {
    await instance.close();
  }
}

describe("criterion 8 — a run keeps the memories of its agents in the database of the instance", () => {
  it("writes what the agent that plans remembers to the database, and no file of notes", async () => {
    terminal = await Terminal.open(remembering());
    const run = await terminal.oqas(BRIEF);
    assert.equal(run.code, 0, run.err);
    const kept = terminal.server.requests.find((request) => (JSON.stringify(request.body) ?? "").includes('"tool_call_id":"mem"'));
    assert.match(JSON.stringify(kept?.body), /Kept as [0-9a-f-]{36}\./);
    assert.deepEqual(await memoriesOf(terminal.root), [{ ...REMEMBERED, role: "planner" }]);
    assert.equal(existsSync(join(terminal.root, ".oqas", "memory")), false);
  });

  it("neither reads nor changes the file of notes an earlier version left", async () => {
    terminal = await Terminal.open(remembering());
    const notes = join(terminal.root, ".oqas", "memory", "notes.jsonl");
    mkdirSync(join(terminal.root, ".oqas", "memory"), { recursive: true });
    writeFileSync(notes, EARLIER_NOTES);
    const run = await terminal.oqas(BRIEF);
    assert.equal(run.code, 0, run.err);
    assert.deepEqual(await memoriesOf(terminal.root), [{ ...REMEMBERED, role: "planner" }]);
    assert.equal(readFileSync(notes, "utf8"), EARLIER_NOTES);
  });
});
