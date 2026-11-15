import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlannedScenario, TerminalEvent } from "@open-qa-stack/domain";
import { CoherenceReviewer, type CoherenceSession } from "../src/coherence-reviewer/coherence-reviewer.ts";
import { COHERENCE_REVIEWER_INSTRUCTIONS } from "../src/coherence-reviewer/coherence-reviewer-prompt.ts";

const COUNTERS = { iterations: 1, actions: 0, elapsedMs: 1 };
const END = { type: "end", counters: COUNTERS } as unknown as TerminalEvent;
const SCENARIO: PlannedScenario = {
  id: "find-order",
  title: "Find an order by its customer",
  intent: "Verifies that a search by last name finds the order.",
  kind: "functional",
  level: "functional",
  case: "nominal",
  effect: "read",
  application: "shop",
  domain: "orders",
  feature: "listing",
  sources: [{ source: "shop" }],
  data: [{ value: "Veldane", from: "shop" }],
  steps: [
    { action: "Open the orders", code: [], expects: [] },
    { action: "Search Veldane", code: [], expects: [{ result: "Her order shows", shows: ["ORD-1042"], absent: ["ORD-1057"], elements: [] }] },
  ],
};
const TEST = 'import { test } from "@playwright/test";\n\ntest("Find an order by its customer", async ({ page }) => {});\n';

describe("the agent that reviews a test against its scenario", () => {
  it("runs in a session of its own, given the scenario and the test, and reports through its one tool", async () => {
    const tasks: Parameters<CoherenceSession>[0][] = [];
    const reviewer = new CoherenceReviewer(async (task) => {
      tasks.push(task);
      const reminded = task.reminder();
      await task.tools[0]!.execute({
        findings: [
          { where: "step 2", what: `No assertion\n verifies the order.  ${"x".repeat(400)}` },
          { where: "step 1" },
          null,
          { where: 2, what: "No place." },
          ...Array.from({ length: 6 }, (_, at) => ({ where: `step ${at}`, what: "One more." })),
        ],
      });
      assert.deepEqual([typeof reminded, task.reminder()], ["string", undefined]);
      return END;
    });
    const found = await reviewer.judge(SCENARIO, TEST);
    // An entry without its place and its sentence is left out; each is put on one line and cut; five at most are kept.
    assert.deepEqual([found.length, found[0]], [5, { where: "step 2", what: `No assertion verifies the order. ${"x".repeat(400)}`.slice(0, 300) }]);
    const [task] = tasks;
    assert.equal(task!.instructions, COHERENCE_REVIEWER_INSTRUCTIONS);
    assert.deepEqual(
      task!.tools.map((tool) => tool.name),
      ["report_findings"],
    );
    assert.equal(
      task!.request,
      [
        "Scenario find-order — Find an order by its customer (functional, nominal).",
        "Intent: Verifies that a search by last name finds the order.",
        'Data: "Veldane".',
        'Steps, each with what it expects:\n1. Open the orders\n2. Search Veldane\n   - Her order shows: shows "ORD-1042", no longer shows "ORD-1057"',
        `The test:\n\`\`\`ts\n${TEST.trimEnd()}\n\`\`\``,
        "Next: call report_findings with what the test does not do or verify of its scenario, or with an empty list.",
      ].join("\n\n"),
    );
  });

  it("finds nothing in a test it reports nothing of, and reads a scenario without data or texts", async () => {
    const bare = {
      ...SCENARIO,
      data: [],
      steps: [{ action: "Open the orders", code: [], expects: [{ result: "The page opens", shows: [], absent: [], elements: [] }] }],
    };
    let request = "";
    const reviewer = new CoherenceReviewer(async (task) => {
      request = task.request;
      await task.tools[0]!.execute({ findings: "none" });
      return END;
    });
    assert.deepEqual(await reviewer.judge(bare, TEST), []);
    assert.ok(request.includes("Data: none.\n\nSteps, each with what it expects:\n1. Open the orders\n   - The page opens\n\n"), request);
  });

  it("throws when its session fails, reaches a limit or ends without a report", async () => {
    const ended = (last: unknown) => new CoherenceReviewer(async () => last as TerminalEvent).judge(SCENARIO, TEST);
    await assert.rejects(ended({ type: "error", error: { message: "The model did not answer." } }), /The model did not answer\./);
    await assert.rejects(ended({ type: "stopped", reason: { limit: "iterations" } }), /the review reached its iterations limit\./);
    await assert.rejects(ended(END), /the review ended without a report\./);
  });

  it("is told to report only what breaks the scenario, and nothing of style", () => {
    for (const said of ["each step does what its action says", "an assertion that cannot fail", "When in doubt, it is no finding", "Call report_findings once"])
      assert.ok(COHERENCE_REVIEWER_INSTRUCTIONS.includes(said), said);
  });
});
