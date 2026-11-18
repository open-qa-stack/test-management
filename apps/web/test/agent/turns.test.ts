import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ShownStep } from "../../src/agent/playback.ts";
import type { Step } from "../../src/agent/session-script.ts";
import { turnsOf, type Turn } from "../../src/agent/turns.ts";
import { liveOf } from "./session-fixture.ts";

/**
 * Shows steps in full, as a thread that follows an ended session does.
 *
 * @param steps - The steps, in order.
 * @returns Each with its rank, its text written, none running.
 */
function shownOf(steps: readonly Step[]): ShownStep[] {
  return steps.map((step, index) => ({ index, step, written: step.kind === "say" ? step.text : "", running: false }));
}

/**
 * Sums a turn up as its kind, who it is of when it is of an agent, and the ranks of its steps.
 *
 * @param turn - The turn.
 * @returns The summary, such as `agent:planner 5,6,7`.
 */
function summaryOf(turn: Turn): string {
  const ranks = "items" in turn ? turn.items.map(({ index }) => index) : [turn.shown.index];
  return `${turn.kind}${turn.kind === "agent" ? `:${turn.agent}` : ""} ${ranks.join(",")}`;
}

const NOTE: Step = { kind: "note", at: "09:00:00", text: "A note." };
const THOUGHT: Step = { kind: "say", from: "planner", at: "09:00:01", text: "I think.", thinking: true };
const ACTION: Step = { kind: "tool", from: "planner", at: "09:00:02", icon: "web", title: "A ouvert /" };
const ANSWER: Step = { kind: "say", from: "writer", at: "09:00:03", text: "Done." };

describe("the turns of a thread", () => {
  it("are none when the thread shows nothing", () => {
    assert.deepEqual(turnsOf([]), []);
  });

  it("read the session of the fixtures as a conversation, every step kept once and in order", () => {
    const { shown } = liveOf().frame;
    const turns = turnsOf(shown);
    assert.deepEqual(turns.map(summaryOf), [
      "card 0",
      "notes 1",
      "card 2",
      "request 3",
      "brief 4",
      "agent:planner 5,6,7",
      "card 8",
      "card 9",
      "card 10",
      "agent:writer 11,12",
    ]);
    assert.deepEqual(turns[3], { kind: "request", shown: shown[3] });
    assert.deepEqual(turns[5], { kind: "agent", agent: "planner", items: shown.slice(5, 8) });
  });

  it("name an agent once for what it thinks, says and does in a row, and again when another agent came in between", () => {
    const again: Step = { ...ACTION, at: "09:00:04" };
    assert.deepEqual(turnsOf(shownOf([THOUGHT, ACTION, ANSWER, again])).map(summaryOf), ["agent:planner 0,1", "agent:writer 2", "agent:planner 3"]);
  });

  it("start a new turn of the same agent after anything else: a note, a card, a message of the harness or of the person", () => {
    const between: readonly Step[] = [
      NOTE,
      { kind: "verdict", at: "09:00:02", accepted: true, about: "Plan", text: "Accepted." },
      { kind: "say", from: "harness", to: "planner", at: "09:00:02", text: "Go on." },
      { kind: "say", from: "user", at: "09:00:02", text: "merci" },
    ];
    for (const step of between) {
      assert.deepEqual(
        turnsOf(shownOf([THOUGHT, step, ACTION])).map((turn) => turn.kind),
        ["agent", turnsOf(shownOf([step]))[0]!.kind, "agent"],
        step.kind,
      );
    }
  });

  it("gather the notes that follow one another, and only those", () => {
    const turns = turnsOf(shownOf([NOTE, NOTE, NOTE, ANSWER, NOTE]));
    assert.deepEqual(turns.map(summaryOf), ["notes 0,1,2", "agent:writer 3", "notes 4"]);
  });

  it("give the request of the person and each message of the harness to an agent a turn of its own", () => {
    const asked: Step = { kind: "say", from: "user", at: "09:00:00", text: "tester" };
    const brief: Step = { kind: "say", from: "harness", to: "writer", at: "09:00:01", text: "Write it." };
    assert.deepEqual(turnsOf(shownOf([asked, asked, brief, brief])).map(summaryOf), ["request 0", "request 1", "brief 2", "brief 3"]);
  });

  it("give a message the person sent during the session a turn of its own, waiting for an agent until a delivery names it", () => {
    const asked: Step = { kind: "say", from: "user", at: "09:00:00", text: "tester" };
    const first: Step = { kind: "say", from: "user", at: "09:00:04", text: "sans le profil", number: 1 };
    const second: Step = { kind: "say", from: "user", at: "09:00:05", text: "et vite", number: 2 };
    const delivery: Step = { kind: "delivery", at: "09:00:06", message: 2, to: "writer" };
    const shown = shownOf([asked, first, second, ANSWER, delivery]);
    assert.deepEqual(turnsOf(shown.slice(0, 4)).map(summaryOf), ["request 0", "message 1", "message 2", "agent:writer 3"]);
    assert.deepEqual(turnsOf(shown), [
      { kind: "request", shown: shown[0] },
      { kind: "message", shown: shown[1] },
      { kind: "message", shown: shown[2], deliveredTo: "writer" },
      { kind: "agent", agent: "writer", items: [shown[3]] },
    ]);
  });

  it("make no turn of a delivery: an agent goes on under its name across it, and the notes of the harness stay gathered", () => {
    const sent: Step = { kind: "say", from: "user", at: "09:00:00", text: "sans le profil", number: 1 };
    const delivery: Step = { kind: "delivery", at: "09:00:02", message: 1, to: "planner" };
    assert.deepEqual(turnsOf(shownOf([sent, THOUGHT, delivery, ACTION, NOTE, delivery, NOTE])).map(summaryOf), ["message 0", "agent:planner 1,3", "notes 4,6"]);
  });

  it("ignore the delivery of a message the thread does not show", () => {
    const delivery: Step = { kind: "delivery", at: "09:00:02", message: 3, to: "planner" };
    assert.deepEqual(turnsOf(shownOf([THOUGHT, delivery])).map(summaryOf), ["agent:planner 0"]);
  });

  it("leave the start of a pass, a verdict, a plan and the outcome each alone, as a card", () => {
    const cards: readonly Step[] = [
      { kind: "pass", at: "09:00:00", title: "Plan", summary: "" },
      { kind: "pass", at: "09:00:00", title: "Plan", summary: "" },
      { kind: "verdict", at: "09:00:01", accepted: false, about: "Plan", text: "Refused." },
      { kind: "plan", at: "09:00:02", title: "Plan accepté", scenarios: [] },
      { kind: "outcome", at: "09:00:03", title: "Verdict", tests: [] },
    ];
    assert.deepEqual(turnsOf(shownOf(cards)).map(summaryOf), ["card 0", "card 1", "card 2", "card 3", "card 4"]);
  });

  it("keep the steps as the thread shows them, the one still going included", () => {
    const running: ShownStep = { index: 7, step: ACTION, written: "", running: true };
    const [turn] = turnsOf([running]);
    assert.deepEqual(turn, { kind: "agent", agent: "planner", items: [running] });
  });
});
