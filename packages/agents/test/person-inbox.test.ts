import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, it } from "vitest";
import { PersonInbox } from "../src/index.ts";

const workspace = mkdtempSync(join(tmpdir(), "oqas-inbox-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

let files = 0;
const fresh = () => join(workspace, `inbox-${++files}.jsonl`);
const line = (text: unknown, at = "2026-11-13T12:00:00.000Z") => `${JSON.stringify({ at, text })}\n`;

describe("the inbox of a run", () => {
  it("is empty while its file does not exist, and gives the messages once the file is written", () => {
    const path = fresh();
    const inbox = new PersonInbox(path);
    assert.deepEqual([inbox.pending(), inbox.unreadable], [[], undefined]);
    writeFileSync(path, line("Test the search, not the profile."));
    assert.deepEqual(inbox.pending(), [{ number: 1, text: "Test the search, not the profile." }]);
  });

  it("is empty, and says why once, when its file is there and cannot be read", () => {
    const folder = join(workspace, "a-folder.jsonl");
    mkdirSync(folder);
    const inbox = new PersonInbox(folder);
    assert.equal(inbox.unreadable, undefined);
    assert.deepEqual(inbox.pending(), []);
    const why = inbox.unreadable;
    assert.match(why!, /EISDIR/);
    assert.deepEqual(inbox.pending(), []);
    assert.equal(inbox.unreadable, why);
  });

  it("reads what the file gains, numbers the messages in the order of their lines, and gives one again until it is delivered", () => {
    const path = fresh();
    const inbox = new PersonInbox(path);
    writeFileSync(path, line("One."));
    assert.deepEqual(inbox.pending(), [{ number: 1, text: "One." }]);
    assert.deepEqual(inbox.pending(), [{ number: 1, text: "One." }]);
    appendFileSync(path, line("Two.") + line("Three."));
    assert.deepEqual(
      inbox.pending().map((message) => message.number),
      [1, 2, 3],
    );
    inbox.delivered(2);
    assert.deepEqual(inbox.pending(), [{ number: 3, text: "Three." }]);
    inbox.delivered(3);
    appendFileSync(path, line("Four."));
    assert.deepEqual(inbox.pending(), [{ number: 4, text: "Four." }]);
  });

  it("keeps the messages delivered, in their order, as what the run heard so far", () => {
    const path = fresh();
    const inbox = new PersonInbox(path);
    writeFileSync(path, line("One.") + line("Two.") + line("Three."));
    assert.deepEqual([inbox.heard(), inbox.pending().length], [[], 3]);
    inbox.delivered(1);
    assert.deepEqual(inbox.heard(), [{ number: 1, text: "One." }]);
    inbox.delivered(3);
    // Marking again what was received already changes nothing.
    inbox.delivered(3);
    assert.deepEqual(inbox.heard(), [
      { number: 1, text: "One." },
      { number: 2, text: "Two." },
      { number: 3, text: "Three." },
    ]);
    assert.deepEqual(inbox.pending(), []);
  });

  it("leaves a last line without its end until it is whole, even cut inside a character", () => {
    const path = fresh();
    const inbox = new PersonInbox(path);
    const bytes = Buffer.from(line("Vérifie l’adresse."));
    const cut = bytes.indexOf(Buffer.from("é")) + 1;
    writeFileSync(path, Buffer.concat([Buffer.from(line("One.")), bytes.subarray(0, cut)]));
    assert.deepEqual(inbox.pending(), [{ number: 1, text: "One." }]);
    appendFileSync(path, bytes.subarray(cut));
    assert.deepEqual(inbox.pending(), [
      { number: 1, text: "One." },
      { number: 2, text: "Vérifie l’adresse." },
    ]);
  });

  it("skips a line that is no message, which still takes its number", () => {
    const path = fresh();
    const skipped = ["{ not json\n", "\n", "null\n", '"a text"\n', '{"at":"2026-11-13T12:00:00.000Z"}\n', line(7), line(""), line("  \t")];
    writeFileSync(path, [line("First."), ...skipped, '{"text":"Last, without a date."}\r\n'].join(""));
    assert.deepEqual(new PersonInbox(path).pending(), [
      { number: 1, text: "First." },
      { number: skipped.length + 2, text: "Last, without a date." },
    ]);
  });
});
