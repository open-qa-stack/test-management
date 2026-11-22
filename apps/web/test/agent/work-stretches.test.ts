import assert from "node:assert/strict";
import { turnsOf, type Step } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import type { ShownStep } from "../../src/agent/playback.ts";
import { stretchesOf } from "../../src/agent/work-stretches.ts";

/**
 * The entries of a thread that shows steps, the last one still going when asked.
 *
 * @param steps - The steps, in order.
 * @param running - Whether the last step is still going.
 * @returns The entries, each summed up as its kind and its counts.
 */
function entriesOf(steps: readonly Step[], running = false): string[] {
  const shown: ShownStep[] = steps.map((step, index) => ({ index, step, written: "", running: running && index === steps.length - 1 }));
  return stretchesOf(turnsOf(shown)).map((entry) =>
    entry.kind === "stretch"
      ? `stretch ${entry.agents.join("+")} ${entry.actions}a ${entry.failed}f ${entry.refusals}r ${entry.notes}n ${entry.durationMs}ms${entry.running ? " running" : ""}`
      : entry.kind,
  );
}

const THOUGHT: Step = { kind: "say", from: "planner", at: "09:00:00", text: "I look.", thinking: true };
const OPENED: Step = { kind: "tool", from: "planner", at: "09:00:01", tool: "shop_goto", title: "Opened /", durationMs: 300 };
const FAILED: Step = { kind: "tool", from: "planner", at: "09:00:02", tool: "shop_click", title: "Clicked", outcome: "failed", durationMs: 200 };
const PENDING: Step = { kind: "tool", from: "writer", at: "09:00:02", tool: "run_test", title: "Ran", pending: true };
const REFUSED: Step = { kind: "verdict", at: "09:00:03", accepted: false, about: "Plan", tool: "shop_click", text: "No.", reason: "No." };
const ACCEPTED: Step = { kind: "verdict", at: "09:00:03", accepted: true, about: "Plan", text: "Yes.", reason: "Yes." };
const NOTE: Step = { kind: "note", at: "09:00:04", text: "A note." };
const SAID: Step = { kind: "say", from: "planner", at: "09:00:05", text: "Here is the plan." };
const BRIEF: Step = { kind: "say", from: "harness", to: "writer", at: "09:00:06", text: "Write it." };

describe("the stretches of work of a thread", () => {
  it("fold what the agents did and what the harness answered in a row, counted, and leave what is said in sight", () => {
    assert.deepEqual(entriesOf([THOUGHT, OPENED, REFUSED, OPENED, FAILED, REFUSED, NOTE, SAID, BRIEF]), [
      "stretch planner 3a 1f 2r 1n 800ms",
      "agent",
      "brief",
    ]);
  });

  it("leave a turn of work alone as it is, and an accepted verdict out of any stretch", () => {
    assert.deepEqual(entriesOf([OPENED, ACCEPTED, REFUSED, BRIEF, NOTE]), ["agent", "card", "card", "brief", "notes"]);
  });

  it("name every agent at work in them, none for the harness alone, and say one is still going", () => {
    assert.deepEqual(entriesOf([OPENED, BRIEF, REFUSED, NOTE, PENDING], true), ["agent", "brief", "stretch writer 1a 0f 1r 1n 0ms running"]);
    assert.deepEqual(entriesOf([REFUSED, NOTE]), ["stretch  0a 0f 1r 1n 0ms"]);
    assert.deepEqual(entriesOf([OPENED, { ...PENDING, pending: false, durationMs: 100 }, OPENED]), ["stretch planner+writer 3a 0f 0r 0n 700ms"]);
  });
});
