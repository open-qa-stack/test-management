import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionEvent } from "@open-qa-stack/shared/sessions";
import { RunFolder, SILENCE_MS } from "../src/solo/run-folder.ts";
import { RunReading } from "../src/solo/run-reading.ts";
import { at, delivered, entry, sent, traced } from "./support/run-lines.ts";
import { FIRST, SECOND, stampOf, TestRepository } from "./support/test-repository.ts";

/** A clock a test sets, in seconds after the start of the first run. */
class Clock {
  seconds = 3600;
  readonly now = (): Date => new Date(at(this.seconds));
}

/** A reading of the first run of a repository, with the clock it reads, which starts an hour after the run. */
function readingOf(repository: TestRepository, settleMs = 0, marginMs = 0): { reading: RunReading; clock: Clock } {
  const clock = new Clock();
  return { reading: new RunReading(new RunFolder(repository.root, clock.now), FIRST, clock.now, settleMs, marginMs), clock };
}

/** What a test compares of events: their identifiers and what tells them apart. */
function told(events: readonly SessionEvent[]): unknown[] {
  return events.map((event) => [event.id, event.type, "text" in event ? event.text : "state" in event ? event.state : "phase" in event ? event.phase : ""]);
}

const said = (seconds: number, text: string) => traced(seconds, "plan", "agent", { type: "text", text });
const noted = (seconds: number, text: string) => entry(seconds, "configuration", "info", text);

describe("the reading of a run", () => {
  it("gives everything the run wrote on the first reading, its journal and its traces together in the order of their dates", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, noted(9, "Third.") + noted(30, "Sixth."));
    repository.trace("writer", stampOf(FIRST, 2), said(20, "Fifth."));
    repository.trace("planner", stampOf(FIRST, 1), said(9, "Fourth.") + said(3, "First.") + said(3, "Second."));
    assert.deepEqual(told(await readingOf(repository).reading.read()), [
      [1, "agent_message", "First."],
      [2, "agent_message", "Second."],
      [3, "note", "Third."],
      [4, "agent_message", "Fourth."],
      [5, "agent_message", "Fifth."],
      [6, "note", "Sixth."],
    ]);
  });

  it("gives nothing while the run writes nothing, then only what it appended, numbered after what came before", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, noted(1, "One."));
    repository.trace("planner", stampOf(FIRST), said(2, "Two."));
    const { reading } = readingOf(repository);
    assert.equal((await reading.read()).length, 2);
    assert.deepEqual(await reading.read(), []);
    repository.journal(FIRST, noted(3, "Three."));
    assert.deepEqual(told(await reading.read()), [[3, "note", "Three."]]);
    repository.trace("planner", stampOf(FIRST), said(4, "Four.") + said(5, "Five."));
    assert.deepEqual(told(await reading.read()), [
      [4, "agent_message", "Four."],
      [5, "agent_message", "Five."],
    ]);
    assert.deepEqual(await reading.read(), []);
  });

  it("picks up a trace the run started after the first reading, and leaves the traces of the next run out", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, noted(1, "One."));
    repository.journal(SECOND, noted(1, "Of the next run."));
    repository.trace("planner", stampOf(SECOND), said(2, "Of the next run."));
    const { reading } = readingOf(repository);
    assert.deepEqual(told(await reading.read()), [[1, "note", "One."]]);
    repository.trace("writer", stampOf(FIRST, 30), said(2, "First of the writer."));
    assert.deepEqual(told(await reading.read()), [[2, "agent_message", "First of the writer."]]);
  });

  it("leaves out what is no line of a trace nor an entry of the journal", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, `not an entry\n{}\n${entry(1, "design", "started", "The design starts.")}${noted(2, "Kept.")}`);
    repository.trace("planner", stampOf(FIRST), `not a line\n{}\n${said(3, "Kept too.")}`);
    assert.deepEqual(told(await readingOf(repository).reading.read()), [
      [1, "note", "Kept."],
      [2, "agent_message", "Kept too."],
    ]);
  });

  it("tells why a run stopped before its agents worked: the errors its journal alone holds, and once those a trace tells too", async () => {
    const repository = new TestRepository();
    const refused = "The plan was refused: nothing can be tested. The design stops; no test is written.";
    repository.journal(
      FIRST,
      entry(1, "cartography", "info", "The index was kept.") +
        entry(2, "design", "started", "The design starts.") +
        entry(4, "design", "error", refused) +
        entry(4, "design", "error", "Tracked files are changed: oqas.json.") +
        entry(4, "design", "info", "Pass functional: 0 tests.") +
        entry(4, "design", "finished", "The design did not succeed."),
    );
    repository.trace("design", stampOf(FIRST), traced(4, "plan", "harness", { type: "journal", level: "error", message: refused }));
    const { reading } = readingOf(repository);
    assert.deepEqual(told(await reading.read()), [
      [1, "refusal", refused],
      [2, "refusal", "Tracked files are changed: oqas.json."],
    ]);
    assert.deepEqual(told(await reading.read()), []);
  });

  it("holds back a line dated after the reading began, so that a file late to be read cannot gain a line that belongs before one already told", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, noted(1, "One."));
    repository.trace("planner", stampOf(FIRST), said(15, "Three, written before two was read."));
    const { reading, clock } = readingOf(repository);
    clock.seconds = 10;
    assert.deepEqual(told(await reading.read()), [[1, "note", "One."]]);
    repository.journal(FIRST, noted(12, "Two."));
    clock.seconds = 15;
    assert.deepEqual(told(await reading.read()), [[2, "note", "Two."]]);
    clock.seconds = 16;
    assert.deepEqual(told(await reading.read()), [[3, "agent_message", "Three, written before two was read."]]);
  });

  it("holds back a line dated within its margin before the reading began, which the run may still be writing lines of", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, noted(1, "One.") + noted(9, "Two.") + noted(10, "Three."));
    const { reading, clock } = readingOf(repository, 0, 2000);
    clock.seconds = 11;
    assert.deepEqual(told(await reading.read()), [[1, "note", "One."]]);
    clock.seconds = 12;
    assert.deepEqual(told(await reading.read()), [[2, "note", "Two."]]);
    clock.seconds = 12.001;
    assert.deepEqual(told(await reading.read()), [[3, "note", "Three."]]);
  });

  it("numbers the events the same however the readings are paced", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, noted(1, "One."));
    const paced = readingOf(repository);
    const events = await paced.reading.read();
    repository.trace("planner", stampOf(FIRST), said(2, "Two.") + said(4, "Four."));
    repository.journal(FIRST, noted(2, "Two, of the journal.") + noted(3, "Three."));
    paced.clock.seconds = 3;
    events.push(...(await paced.reading.read()));
    paced.clock.seconds = 3600;
    events.push(...(await paced.reading.read()));
    repository.end(FIRST, { exitCode: 0 });
    for (const path of [repository.journalPath(FIRST), repository.tracePath("planner", stampOf(FIRST)), repository.statePath(FIRST)]) {
      repository.touch(path, new Date(at(5)));
    }
    events.push(...(await paced.reading.read()));
    assert.deepEqual(told(events), [
      [1, "note", "One."],
      [2, "note", "Two, of the journal."],
      [3, "agent_message", "Two."],
      [4, "note", "Three."],
      [5, "agent_message", "Four."],
      [6, "state_changed", "completed"],
    ]);
    assert.deepEqual(await readingOf(repository).reading.read(), events);
  });

  it("tells what a person sent to the run among its lines, in the order of their dates: each message under its number, then its delivery", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, noted(1, "One.") + noted(4, "Four, of the journal."));
    repository.inbox(FIRST, sent(2, "not that page") + sent(4, "the other one"));
    repository.trace("design-local", stampOf(FIRST), delivered(3, "write", 1) + delivered(5, "plan", 2));
    const { reading } = readingOf(repository);
    assert.deepEqual(await reading.read(), [
      { id: 1, at: at(1), type: "note", phase: "configuration", text: "One." },
      { id: 2, at: at(2), type: "user_message", text: "not that page", number: 1 },
      { id: 3, at: at(3), type: "message_delivered", message: 1, agent: "writer" },
      { id: 4, at: at(4), type: "note", phase: "configuration", text: "Four, of the journal." },
      { id: 5, at: at(4), type: "user_message", text: "the other one", number: 2 },
      { id: 6, at: at(5), type: "message_delivered", message: 2, agent: "planner" },
    ]);
    repository.inbox(FIRST, sent(6, "and one more"));
    assert.deepEqual(await reading.read(), [{ id: 7, at: at(6), type: "user_message", text: "and one more", number: 3 }]);
    assert.deepEqual(await readingOf(repository).reading.read().then(told), [
      [1, "note", "One."],
      [2, "user_message", "not that page"],
      [3, "message_delivered", ""],
      [4, "note", "Four, of the journal."],
      [5, "user_message", "the other one"],
      [6, "message_delivered", ""],
      [7, "user_message", "and one more"],
    ]);
  });

  it("numbers the messages as the command line does: a line of the inbox that is no message is not told, and still takes its number", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, noted(1, "One."));
    repository.inbox(FIRST, `${sent(2, "first")}not json\n\n${sent(3, " ")}${sent(4, "fifth")}`);
    const { reading } = readingOf(repository);
    const numbered = (events: readonly SessionEvent[]) => events.flatMap((event) => (event.type === "user_message" ? [[event.number, event.text]] : []));
    assert.deepEqual(numbered(await reading.read()), [
      [1, "first"],
      [5, "fifth"],
    ]);
    repository.inbox(FIRST, `{"text":"undated"}\n${sent(5, "seventh")}`);
    assert.deepEqual(numbered(await reading.read()), [[7, "seventh"]]);
  });

  it("fails when the repository no longer holds the run", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, noted(1, "One."));
    const { reading } = readingOf(repository);
    await reading.read();
    repository.remove(repository.journalPath(FIRST));
    await assert.rejects(reading.read(), { message: `The test repository no longer holds the run ${FIRST}.` });
  });
  it("fails the same when the journal of the run is removed while it is read, instead of calling the run interrupted", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, noted(1, "One."));
    const clock = new Clock();
    /** A folder that loses the journal of a run right after it listed its files. */
    class LosingFolder extends RunFolder {
      override async files(id: string): ReturnType<RunFolder["files"]> {
        const files = await super.files(id);
        repository.remove(repository.journalPath(id));
        return files;
      }
    }
    const reading = new RunReading(new LosingFolder(repository.root, clock.now), FIRST, clock.now, 0, 0);
    await assert.rejects(reading.read(), { message: `The test repository no longer holds the run ${FIRST}.` });
  });
});

describe("the end of the session of a run", () => {
  it("is told without looking for the brief of the run in its traces", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, noted(1, "One."));
    repository.trace("design-local", stampOf(FIRST), traced(2, "plan", "harness", { type: "message", text: "<brief>cover the profile</brief>" }));
    const clock = new Clock();
    const folder = new RunFolder(repository.root, clock.now);
    await new RunReading(folder, FIRST, clock.now, 0, 0).read();
    // Had the reading looked for the brief, the folder would remember the one the trace quoted then.
    repository.remove(repository.tracePath("design-local", stampOf(FIRST)));
    repository.trace("design-local", stampOf(FIRST), traced(2, "plan", "harness", { type: "message", text: "<brief>cover the orders</brief>" }));
    assert.equal((await folder.session(FIRST))?.request, "cover the orders");
  });

  it("is told once, after every line, when the run wrote its state: completed, dated by its last write", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, noted(1, "One."));
    repository.end(FIRST, { exitCode: 0 });
    for (const path of [repository.journalPath(FIRST), repository.statePath(FIRST)]) repository.touch(path, new Date(at(2)));
    const { reading } = readingOf(repository);
    assert.deepEqual(await reading.read(), [
      { id: 1, at: at(1), type: "note", phase: "configuration", text: "One." },
      { id: 2, at: at(2), type: "state_changed", state: "completed" },
    ]);
    assert.deepEqual(await reading.read(), []);
  });

  it("is dated by the last line when the files were last written before it", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, noted(8, "Late."));
    repository.end(FIRST, {});
    for (const path of [repository.journalPath(FIRST), repository.statePath(FIRST)]) repository.touch(path, new Date(at(2)));
    assert.deepEqual((await readingOf(repository).reading.read()).at(-1), { id: 2, at: at(8), type: "state_changed", state: "completed" });
  });

  it("is told of a run that wrote nothing the thread tells", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, "{}\n");
    repository.end(FIRST, {});
    for (const path of [repository.journalPath(FIRST), repository.statePath(FIRST)]) repository.touch(path, new Date(at(2)));
    assert.deepEqual(await readingOf(repository).reading.read(), [{ id: 1, at: at(2), type: "state_changed", state: "completed" }]);
  });

  it("is interrupted when the run wrote no state and has been silent for longer than ten minutes", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, noted(1, "One."));
    repository.touch(repository.journalPath(FIRST), new Date(at(2)));
    const { reading, clock } = readingOf(repository);
    clock.seconds = 2 + SILENCE_MS / 1000;
    assert.deepEqual(told(await reading.read()), [[1, "note", "One."]]);
    clock.seconds += 1;
    assert.deepEqual(await reading.read(), [{ id: 2, at: at(2), type: "state_changed", state: "interrupted" }]);
    assert.deepEqual(await reading.read(), []);
  });

  it("is interrupted all the same when a message is sent to a run that went silent, and is then dated by that message, the last event told", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, noted(1, "One."));
    repository.touch(repository.journalPath(FIRST), new Date(at(2)));
    repository.inbox(FIRST, sent(3000, "are you there?"));
    assert.deepEqual(await readingOf(repository).reading.read(), [
      { id: 1, at: at(1), type: "note", phase: "configuration", text: "One." },
      { id: 2, at: at(3000), type: "user_message", text: "are you there?", number: 1 },
      { id: 3, at: at(3000), type: "state_changed", state: "interrupted" },
    ]);
  });

  it("waits until the run has been silent for the settle time, and while a line is held back", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, noted(1, "One.") + noted(40, "Held back."));
    repository.end(FIRST, {});
    for (const path of [repository.journalPath(FIRST), repository.statePath(FIRST)]) repository.touch(path, new Date(at(10)));
    const { reading, clock } = readingOf(repository, 5000);
    clock.seconds = 14;
    assert.deepEqual(told(await reading.read()), [[1, "note", "One."]]);
    clock.seconds = 15;
    assert.deepEqual(await reading.read(), []);
    clock.seconds = 41;
    assert.deepEqual(told(await reading.read()), [
      [2, "note", "Held back."],
      [3, "state_changed", "completed"],
    ]);
  });

  it("is followed by the state of a run that writes again after it was called interrupted", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, noted(1, "One."));
    repository.touch(repository.journalPath(FIRST), new Date(at(2)));
    const { reading, clock } = readingOf(repository);
    assert.deepEqual(told(await reading.read()).at(-1), [2, "state_changed", "interrupted"]);
    repository.journal(FIRST, noted(3601, "Back."));
    repository.touch(repository.journalPath(FIRST), new Date(at(3601)));
    clock.seconds = 3602;
    assert.deepEqual(told(await reading.read()), [
      [3, "note", "Back."],
      [4, "state_changed", "running"],
    ]);
  });
});
