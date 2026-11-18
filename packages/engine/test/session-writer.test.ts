import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";
import { MessageNotPendingError, SessionEndedError, SessionStateError, UnknownSessionError } from "@open-qa-stack/domain";
import type { SessionResult, UnrankedEvent } from "@open-qa-stack/domain/sessions";
import { beforeEach, describe, it } from "vitest";
import { SessionWriter } from "../src/sessions/session-writer.ts";
import { eventually } from "./support/eventually.ts";
import { held } from "./support/held.ts";
import { RecordingLogger } from "./support/recording-logger.ts";
import { ScriptedStore } from "./support/scripted-store.ts";

const AT = "2026-11-16T08:00:00.000Z";
const RESULT: SessionResult = { outcome: "passed", durationMs: 1000, modelRequests: 2, tests: [] };
const note = (text: string): UnrankedEvent => ({ at: AT, type: "note", phase: "plan", text });
const delivery = (message: number): UnrankedEvent => ({ at: AT, type: "message_delivered", message, agent: "planner" });

let store: ScriptedStore;
let logger: RecordingLogger;
let writer: SessionWriter;
/** What the writer signalled, in order. */
let signals: string[];
/** What the host of the writer aborts when it stops waiting. */
let abandoned: AbortController;
beforeEach(() => {
  abandoned = new AbortController();
  store = new ScriptedStore();
  logger = new RecordingLogger();
  signals = [];
  writer = new SessionWriter(store, "s1", logger, { wrote: () => signals.push("wrote"), lost: () => signals.push("lost") }, abandoned.signal, {
    firstRetryMs: 2,
    maxRetryMs: 5,
  });
});

/** The texts of the notes each append wrote, a list an append. */
const appended = (): string[][] => store.taken("append").map(([, events]) => (events as { text: string }[]).map(({ text }) => text));

describe("what a run tells of its session", () => {
  it("is written in the order it was told, what was told in the same turn together, then the end of the session", async () => {
    writer.tell([note("One.")]);
    writer.tell([note("Two."), note("Three.")]);
    await writer.end(RESULT);
    assert.deepEqual(store.sent, [
      ["append", "s1", [note("One."), note("Two."), note("Three.")]],
      ["complete", "s1", RESULT],
    ]);
    assert.deepEqual(logger.lines, []);
    assert.deepEqual(signals, ["wrote", "wrote"], "each write the store took is signalled");
  });

  it("waits while a write is under way, and goes together in the next one", async () => {
    const first = held();
    store.before = () => (store.sent.length === 0 ? first.promise : undefined);
    writer.tell([note("One.")]);
    await pause(5);
    writer.tell([note("Two.")]);
    writer.tell([note("Three.")]);
    first.resolve();
    await writer.end(undefined);
    assert.deepEqual(appended(), [["One."], ["Two.", "Three."]]);
    assert.deepEqual(store.sent.at(-1), ["interrupt", "s1"]);
  });

  it("marks a message delivered with the command of the store that tells it, between the events told before and after it", async () => {
    writer.tell([note("One."), delivery(1), delivery(2), note("Two."), note("Three.")]);
    await writer.end(RESULT);
    assert.deepEqual(
      store.sent.map(([command, , told]) => [command, command === "append" ? (told as unknown[]).length : told]),
      [
        ["append", 1],
        ["deliver", 1],
        ["deliver", 2],
        ["append", 2],
        ["complete", RESULT],
      ],
    );
    assert.deepEqual(store.taken("deliver")[0], ["s1", 1, "planner"]);
  });

  it("takes a delivery the store already holds for done: the write that made it had its answer lost", async () => {
    store.before = (command) => {
      if (command === "deliver") throw new MessageNotPendingError("s1", 1);
    };
    writer.tell([delivery(1), note("One.")]);
    await writer.end(RESULT);
    assert.deepEqual(appended(), [["One."]]);
    assert.deepEqual(store.sent.at(-1)?.[0], "complete");
    assert.deepEqual(logger.lines, []);
  });

  it("is ignored once the session has its end, and so is another end", async () => {
    writer.tell([note("One.")]);
    await writer.end(undefined);
    writer.tell([note("Too late.")]);
    await writer.end(RESULT);
    assert.deepEqual(store.sent, [
      ["append", "s1", [note("One.")]],
      ["interrupt", "s1"],
    ]);
  });
});

describe("a write the store fails to take", () => {
  it("is made again, the same, after a delay that doubles up to a bound, until the store takes it: nothing is lost, nothing is written twice", async () => {
    let failures = 4;
    const attempts: number[] = [];
    store.before = (command) => {
      if (command !== "append") return;
      attempts.push(Date.now());
      failures -= 1;
      if (failures >= 0) throw new Error("The database is unreachable: connection refused");
    };
    writer.tell([note("One."), note("Two.")]);
    await eventually(() => assert.equal(logger.lines.length, 1));
    writer.tell([note("Three.")]);
    await writer.end(RESULT);
    assert.deepEqual(appended(), [["One.", "Two.", "Three."]]);
    assert.deepEqual(logger.lines, [
      "warn The session s1 cannot be written to, and what it tells waits: The database is unreachable: connection refused",
      "log The session s1 is written to again.",
    ]);
    const delays = attempts.slice(1).map((at, index) => at - (attempts[index] as number));
    assert.equal(delays.length, 4);
    assert.ok(
      delays.every((delay) => delay < 50),
      `the delay stays under its bound: ${delays.join(", ")}`,
    );
  });

  it("starts from the first delay again once a write succeeded", async () => {
    let fail = true;
    store.before = (command) => {
      if (command === "append" && fail) {
        fail = false;
        throw new Error("down");
      }
      if (command === "complete" && !fail) {
        fail = true;
        throw new Error("down again");
      }
    };
    writer.tell([note("One.")]);
    await writer.end(RESULT);
    assert.deepEqual(
      store.sent.map(([command]) => command),
      ["append", "complete"],
    );
    assert.deepEqual(logger.lines, [
      "warn The session s1 cannot be written to, and what it tells waits: down",
      "log The session s1 is written to again.",
      "warn The session s1 cannot be written to, and what it tells waits: down again",
      "log The session s1 is written to again.",
    ]);
  });

  it("is made again when it is a delivery too, which the store then tells once", async () => {
    let fail = true;
    store.before = (command) => {
      if (command === "deliver" && fail) {
        fail = false;
        throw new Error("down");
      }
    };
    writer.tell([delivery(1), note("One.")]);
    await writer.end(RESULT);
    assert.deepEqual(
      store.sent.map(([command]) => command),
      ["deliver", "append", "complete"],
    );
  });
});

describe("a write the store fails to take for a host that stops waiting", () => {
  it("is given up, at once when it was waiting to be made again: what waited is dropped, and nothing more is written", async () => {
    const slow = new SessionWriter(store, "s1", logger, { wrote: assert.fail, lost: assert.fail }, abandoned.signal, {
      firstRetryMs: 60_000,
      maxRetryMs: 60_000,
    });
    store.before = () => {
      throw new Error("down");
    };
    slow.tell([note("One.")]);
    const ended = slow.end(RESULT);
    await eventually(() => assert.equal(logger.lines.length, 1));
    abandoned.abort();
    await ended;
    slow.tell([note("Too late.")]);
    await pause(20);
    assert.deepEqual(store.sent, []);
    assert.deepEqual(logger.lines, [
      "warn The session s1 cannot be written to, and what it tells waits: down",
      "warn The session s1 is left as the store holds it: its host stops, and what its run still told is dropped.",
    ]);
  });
});

describe("a session that ended under its execution", () => {
  for (const refusal of [new SessionEndedError("s1"), new SessionStateError("s1", "append", "queued"), new UnknownSessionError("s1")])
    it(`takes nothing more once the store answers ${refusal.name}: what waited is dropped, what the run still tells is ignored, and the execution is told once`, async () => {
      store.before = (command) => {
        if (command === "append") throw refusal;
      };
      writer.tell([note("One."), delivery(1), note("Two.")]);
      await writer.end(RESULT);
      writer.tell([note("Three.")]);
      await pause(10);
      assert.deepEqual(store.sent, []);
      assert.deepEqual(logger.lines, [`warn The session s1 takes nothing more, and what its run still tells is dropped: ${refusal.message}`]);
      assert.deepEqual(signals, ["lost"]);
    });
});
