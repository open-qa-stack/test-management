import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { turnsOf, type SessionPhase, type Step } from "@open-qa-stack/domain/sessions";
import type { ShownStep } from "../../src/agent/playback.ts";
import { conversationOf, groupsOf, opensByItself, type SessionEnding } from "../../src/agent/session-phases.ts";

/** A pass that opens a phase, or a part of one. */
function pass(at: string, phase: SessionPhase, title: string, minor = false): Step {
  return { kind: "pass", at, phase, title, summary: "", ...(minor ? { minor: true } : {}) };
}

/** A session that ran through every phase: configuration, prerequisites, two parts of the cartography, two plans, the second one writing two tests, and its summary. */
const STEPS: readonly Step[] = [
  { kind: "say", from: "user", at: "09:00:00", text: "Test the shop." },
  pass("09:00:01", "configuration", "Configuration"),
  { kind: "note", at: "09:00:02", text: "Ready." },
  pass("09:00:03", "prerequisites", "Prerequisites"),
  pass("09:00:04", "survey", "Cartography · sources"),
  { kind: "say", from: "cartographer", at: "09:00:05", text: "Read." },
  pass("09:00:06", "card", "Cartography · card"),
  { kind: "say", from: "cartographer", at: "09:00:07", text: "Filed." },
  pass("09:00:08", "plan", "Plan · Smoke"),
  { kind: "say", from: "planner", at: "09:00:09", text: "Nothing to add." },
  pass("09:00:10", "plan", "Plan · Functional"),
  pass("09:00:11", "write", "Writing", true),
  pass("09:00:12", "review", "Review", true),
  pass("09:00:13", "write", "Writing", true),
  { kind: "say", from: "writer", at: "09:00:14", text: "Written." },
  pass("09:00:15", "summary", "Summary"),
  { kind: "note", at: "09:00:16", text: "Over." },
];

/** The conversation of steps shown in full. */
function conversation(steps: readonly Step[], ending: SessionEnding) {
  const shown: ShownStep[] = steps.map((step, index) => ({ index, step, written: step.kind === "say" ? step.text : "", running: false }));
  return conversationOf(turnsOf(shown), ending);
}

describe("the phases of a session", () => {
  it("open at each pass that is no part of another, the parts of the cartography after the first and the parts of a plan staying in their phase", () => {
    const { head, phases } = conversation(STEPS, "ended");
    assert.deepEqual(
      head.map((turn) => turn.kind),
      ["request"],
    );
    assert.deepEqual(
      phases.map(({ key, family, title, from, to, written, produced }) => [key, family, title, from, to, written, produced]),
      [
        ["phase-1", "configuration", "Configuration", "09:00:01", "09:00:02", 0, false],
        ["phase-3", "prerequisites", "Prerequisites", "09:00:03", "09:00:03", 0, false],
        ["phase-4", "cartography", "Cartography · sources", "09:00:04", "09:00:07", 0, false],
        ["phase-8", "plan", "Plan · Smoke", "09:00:08", "09:00:09", 0, false],
        ["phase-10", "plan", "Plan · Functional", "09:00:10", "09:00:14", 2, false],
        ["phase-15", "summary", "Summary", "09:00:15", "09:00:16", 0, false],
      ],
    );
    assert.deepEqual(
      phases.map(({ state }) => state),
      ["done", "done", "done", "done", "done", "done"],
    );
  });

  it("go on in the last one while the session does, and stop in the last one at work and in the summary when it stopped without ending", () => {
    assert.deepEqual(
      conversation(STEPS.slice(0, 15), "live").phases.map(({ state }) => state),
      ["done", "done", "done", "done", "current"],
    );
    assert.deepEqual(
      conversation(STEPS, "interrupted").phases.map(({ state }) => state),
      ["done", "done", "done", "done", "interrupted", "interrupted"],
    );
  });

  it("are none before the first pass, everything said then being what opened the session", () => {
    const { head, phases } = conversation(STEPS.slice(0, 1), "live");
    assert.deepEqual([head.length, phases.length], [1, 0]);
  });

  it("open by themselves while they go on, when the session stopped in them, and for the summary", () => {
    const { phases } = conversation(STEPS, "interrupted");
    assert.deepEqual(phases.map(opensByItself), [false, false, false, false, true, true]);
    assert.deepEqual(conversation(STEPS, "ended").phases.map(opensByItself), [false, false, false, false, false, true]);
  });

  it("open by themselves when they hold what the session produced", () => {
    const outcome: Step = { kind: "outcome", at: "09:00:15", title: "Verdicts", tests: [] };
    const [, , , , plan] = conversation([...STEPS.slice(0, 15), outcome], "ended").phases;
    assert.deepEqual([plan!.produced, opensByItself(plan!)], [true, true]);
  });

  it("gather, on the line of their state, the phases of one family in a row, with the state of the last", () => {
    assert.deepEqual(groupsOf(conversation(STEPS.slice(0, 15), "live").phases), [
      { family: "configuration", title: "Configuration", count: 1, state: "done" },
      { family: "prerequisites", title: "Prerequisites", count: 1, state: "done" },
      { family: "cartography", title: "Cartography · sources", count: 1, state: "done" },
      { family: "plan", title: "Plan · Smoke", count: 2, state: "current" },
    ]);
  });
});
