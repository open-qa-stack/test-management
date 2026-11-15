import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { TerminalEvent } from "@open-qa-stack/domain";
import { PlanReviewer, type ReviewSession } from "../src/plan-reviewer/plan-reviewer.ts";
import { PLAN_REVIEWER_INSTRUCTIONS } from "../src/plan-reviewer/plan-reviewer-prompt.ts";

const COUNTERS = { iterations: 1, actions: 0, elapsedMs: 1 };
const END = { type: "end", counters: COUNTERS } as unknown as TerminalEvent;
const KEPT = [{ id: "find-order", text: 'Find an order.\n1. Search -> shows "ORD-1"' }];
const CANDIDATES = [
  { id: "look-up-order", text: "Look up an order." },
  { id: "find-nothing", text: "Search an order that does not exist." },
];

describe("the agent that reviews a plan for duplicates", () => {
  it("runs in a session of its own, given the scenarios kept and the candidates, and reports through its one tool", async () => {
    const tasks: Parameters<ReviewSession>[0][] = [];
    const answers: unknown[] = [];
    const reviewer = new PlanReviewer(async (task) => {
      tasks.push(task);
      const reminded = task.reminder();
      answers.push(
        await task.tools[0]!.execute({
          duplicates: [
            { id: "look-up-order", of: "find-order", reason: `Both search\n an order.  ${"x".repeat(400)}` },
            { id: "find-nothing", of: "find-order" },
            null,
            { id: 1, of: "find-order", reason: "No slug." },
          ],
        }),
      );
      assert.deepEqual([typeof reminded, task.reminder()], ["string", undefined]);
      return END;
    });
    const found = await reviewer.judge(KEPT, CANDIDATES);
    // An entry without its two slugs and its reason is left out; a reason is put on one line and cut.
    assert.deepEqual(found, [{ id: "look-up-order", of: "find-order", reason: `Both search an order. ${"x".repeat(400)}`.slice(0, 300) }]);
    const [task] = tasks;
    assert.equal(task!.instructions, PLAN_REVIEWER_INSTRUCTIONS);
    assert.deepEqual(
      task!.tools.map((tool) => tool.name),
      ["report_duplicates"],
    );
    assert.equal(
      task!.request,
      [
        'Scenarios kept:\n\n### find-order\nFind an order.\n1. Search -> shows "ORD-1"',
        "Candidates, in order:\n\n### look-up-order\nLook up an order.\n\n### find-nothing\nSearch an order that does not exist.",
        "Next: call report_duplicates with the candidates that are duplicates, or with an empty list.",
      ].join("\n\n"),
    );
    assert.deepEqual(answers, ["Recorded. Answer with one word; call no more tools."]);
    // It reviews scenarios, and neither writes one nor reads a test.
    assert.match(
      PLAN_REVIEWER_INSTRUCTIONS,
      /^You review the scenarios of one test plan, written by another agent, for duplicates\. You write no scenario and no test\./,
    );
    assert.match(PLAN_REVIEWER_INSTRUCTIONS, /When in doubt, they are not duplicates/);
  });

  it("reports none for an empty list or a call without one, and names only the candidates when no scenario is kept", async () => {
    let request = "";
    const calling =
      (args: unknown): ReviewSession =>
      async (task) => {
        request = task.request;
        await task.tools[0]!.execute(args);
        return END;
      };
    assert.deepEqual(await new PlanReviewer(calling({ duplicates: [] })).judge([], CANDIDATES), []);
    assert.ok(request.startsWith("Candidates, in order:\n\n### look-up-order\n"));
    assert.deepEqual(await new PlanReviewer(calling({})).judge(KEPT, CANDIDATES), []);
    assert.deepEqual(await new PlanReviewer(calling(null)).judge(KEPT, CANDIDATES), []);
  });

  it("throws when its session fails, reaches a limit or ends without a report, with why", async () => {
    const ending = (last: unknown) => new PlanReviewer(async () => last as TerminalEvent).judge(KEPT, CANDIDATES);
    await assert.rejects(ending({ type: "error", error: new Error("The model answered 500."), counters: COUNTERS }), /^Error: The model answered 500\.$/);
    await assert.rejects(
      ending({ type: "stopped", reason: { limit: "iterations" }, counters: COUNTERS }),
      /^Error: the review reached its iterations limit\.$/,
    );
    await assert.rejects(ending(END), /^Error: the review ended without a report\.$/);
  });
});
