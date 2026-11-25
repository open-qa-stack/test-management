import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { scriptOf, type Step } from "@open-qa-stack/domain/sessions";
import { blocksOf, MAX_LIVE_BLOCKS, settledCount, type Block } from "../../src/conversation/blocks/thread-blocks.ts";
import { progressOf } from "../../src/conversation/blocks/thread-progress.ts";
import { wording } from "../../src/conversation/blocks/wording.ts";
import { COMPLETED, numbered, RUNNING, THREAD, type EventBody, completion } from "./fixtures.ts";

/** The steps a thread shows of events. */
const stepsOf = (bodies: readonly EventBody[]): readonly Step[] => scriptOf(RUNNING, numbered(bodies), wording()).steps;

/** Sums a block up as its kind, with a star when it heads a turn. */
const summaryOf = (block: Block): string => `${block.kind}${"heads" in block && block.heads ? "*" : ""}`;

const NOTE: Step = { kind: "note", at: "09:00:00", text: "A note." };
const PENDING: Step = { kind: "tool", from: "writer", at: "09:00:01", tool: "run_test", title: "Ran the test", pending: true };
const ANSWERED: Step = { kind: "tool", from: "writer", at: "09:00:01", tool: "run_test", title: "Ran the test", durationMs: 4 };
const SENT: Step = { kind: "say", from: "user", at: "09:00:02", text: "Go on.", number: 1 };
const PASS: Step = { kind: "pass", at: "09:00:03", title: "Plan", summary: "" };

describe("the blocks of a thread", () => {
  it("are one per turn, and one per thing an agent said or did or per note of the harness, the first of which heads its turn", () => {
    assert.deepEqual(blocksOf(stepsOf(THREAD)).map(summaryOf), [
      "request",
      "pass",
      "note*",
      "pass",
      "brief",
      "speech*",
      "action",
      "action",
      "verdict",
      "action*",
      "speech",
      "plan",
      "message",
      "pass",
      "action*",
    ]);
    assert.deepEqual(blocksOf([NOTE, NOTE]).map(summaryOf), ["note*", "note"]);
  });

  it("keep each refusal of a row of refusals alike on its own", () => {
    const refusal: Step = { kind: "verdict", at: "09:00:04", accepted: false, about: "Plan", code: "PLAN-SHOWN", text: "No.", reason: "No." };
    assert.deepEqual(blocksOf([refusal, { ...refusal, scenario: "b" }]), [
      { kind: "verdict", step: refusal },
      { kind: "verdict", step: { ...refusal, scenario: "b" } },
    ]);
  });

  it("carry who speaks, and for a message the agent it reached once one took it", () => {
    const blocks = blocksOf(stepsOf([...THREAD, { type: "message_delivered", message: 1, agent: "writer" }]));
    assert.deepEqual(
      blocks.flatMap((block) => (block.kind === "speech" || block.kind === "action" ? [block.agent] : [])),
      ["planner", "planner", "planner", "planner", "planner", "writer"],
    );
    assert.deepEqual(
      blocks.find((block) => block.kind === "message"),
      { kind: "message", step: { kind: "say", from: "user", at: "14:44:22", text: "Leave the archived customers out.", number: 1 }, deliveredTo: "writer" },
    );
    assert.equal("deliveredTo" in blocksOf(stepsOf(THREAD)).find((block) => block.kind === "message")!, false);
  });

  it("close on what the session produced, once it ended", () => {
    const steps = scriptOf(COMPLETED, numbered([...THREAD, completion(COMPLETED)]), wording()).steps;
    assert.equal(blocksOf(steps).at(-1)?.kind, "outcome");
  });
});

describe("the blocks of a thread that are settled", () => {
  it("are all of them once the session ended, whatever is still open", () => {
    assert.equal(settledCount(blocksOf([NOTE, PENDING, SENT, PASS]), false), 4);
    assert.equal(settledCount([], true), 0);
  });

  it("are those before the first that may still change: an action whose tool has not answered, a message no agent took, or the pass the thread ends on", () => {
    assert.equal(settledCount(blocksOf([NOTE, ANSWERED, NOTE]), true), 3);
    assert.equal(settledCount(blocksOf([NOTE, PENDING, NOTE]), true), 1);
    assert.equal(settledCount(blocksOf([NOTE, NOTE, SENT, ANSWERED]), true), 2);
    assert.equal(settledCount(blocksOf([NOTE, PASS]), true), 1);
    assert.equal(settledCount(blocksOf([PASS, NOTE]), true), 2);
    assert.equal(settledCount(blocksOf([SENT, { kind: "delivery", at: "09:00:04", message: 1, to: "writer" }, NOTE]), true), 2);
  });

  it("include a block that stays open while more than a screenful follows it, so that the live part never outgrows the screen", () => {
    const followed = (count: number): Block[] => blocksOf([PENDING, ...Array.from({ length: count }, () => NOTE)]);
    assert.equal(settledCount(followed(MAX_LIVE_BLOCKS), true), 0);
    assert.equal(settledCount(followed(MAX_LIVE_BLOCKS + 1), true), MAX_LIVE_BLOCKS + 2);
    // A later block that is still open holds what follows it, and no more.
    assert.equal(settledCount(blocksOf([PENDING, ...Array.from({ length: MAX_LIVE_BLOCKS + 1 }, () => NOTE), SENT, NOTE]), true), MAX_LIVE_BLOCKS + 2);
  });
});

describe("where the work of a session is", () => {
  it("is the last pass that started, with its scenario, and the agent that last spoke or acted", () => {
    assert.deepEqual(progressOf(scriptOf(RUNNING, numbered(THREAD), wording())), { pass: "Writing a test", scenario: "search", agent: "writer" });
    assert.deepEqual(progressOf(scriptOf(RUNNING, numbered(THREAD.slice(0, 7)), wording())), { pass: "Plan · smoke", agent: "planner" });
  });

  it("names no agent when the thread ends on what the person or the harness said, or on a card, and nothing before the first step", () => {
    assert.deepEqual(progressOf(scriptOf(RUNNING, numbered(THREAD.slice(0, 6)), wording())), { pass: "Plan · smoke" });
    assert.deepEqual(progressOf(scriptOf(RUNNING, numbered(THREAD.slice(0, 17)), wording())), { pass: "Plan · smoke" });
    assert.deepEqual(progressOf(scriptOf(RUNNING, numbered(THREAD.slice(0, 1)), wording())), {});
    assert.deepEqual(progressOf(scriptOf(RUNNING, numbered(THREAD.slice(0, 5)), wording())), { pass: "Plan" });
    assert.deepEqual(progressOf(scriptOf(RUNNING, [], wording())), {});
  });
});
