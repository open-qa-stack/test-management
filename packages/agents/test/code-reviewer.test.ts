import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TerminalEvent } from "@open-qa-stack/domain";
import { CodeReviewer } from "../src/code-reviewer/code-reviewer.ts";
import type { ReviewSession } from "../src/common/reported-findings.ts";

const END = { type: "end", counters: { iterations: 1, actions: 0, elapsedMs: 1 } } as unknown as TerminalEvent;
const TEST = 'import { test } from "@playwright/test";\n\ntest("Find an order", async ({ page }) => {});\n';

describe("the agent that reviews the quality of the code of a test", () => {
  it("runs in a session of its own, with the instructions of its caller, given the test alone, and reports through its one tool", async () => {
    const tasks: Parameters<ReviewSession>[0][] = [];
    const reviewer = new CodeReviewer(async (task) => {
      tasks.push(task);
      const reminded = task.reminder();
      await task.tools[0]!.execute({
        findings: [
          { where: "line 7", what: `A try and catch\n hides the failure.  ${"x".repeat(400)}`, rule: " PW-KEEP-01 ", concerns: "test" },
          { where: "step 1", what: "The date asserted changes every day.", concerns: "plan", rule: "" },
          { where: "step 2", what: "No word on what it concerns." },
          { where: "step 2", what: "Concerns nothing known.", concerns: "style" },
          null,
          ...Array.from({ length: 6 }, (_, at) => ({ where: `line ${at}`, what: "One more.", concerns: "test" })),
        ],
      });
      assert.deepEqual([typeof reminded, task.reminder()], ["string", undefined]);
      return END;
    }, "Review against the charter.");
    const found = await reviewer.judge(TEST);
    // An entry without its place, its sentence and what it concerns is left out; each is put on one line and cut; five at most are kept.
    assert.deepEqual(
      [found.length, found[0], found[1]],
      [
        5,
        { where: "line 7", what: `A try and catch hides the failure. ${"x".repeat(400)}`.slice(0, 300), concerns: "test", rule: "PW-KEEP-01" },
        { where: "step 1", what: "The date asserted changes every day.", concerns: "plan" },
      ],
    );
    const [task] = tasks;
    assert.equal(task!.instructions, "Review against the charter.");
    assert.deepEqual(
      task!.tools.map((tool) => tool.name),
      ["report_quality"],
    );
    assert.equal(task!.request, `The test:\n\`\`\`ts\n${TEST.trimEnd()}\n\`\`\`\n\nNext: call report_quality with what you found, or with an empty list.`);
  });

  it("is given the tools it may read with before it reports, such as the reference of Playwright", async () => {
    let offered: string[] = [];
    const reference = { name: "playwright_read", description: "Reads.", parameters: { type: "object" }, execute: async () => "" };
    const reviewer = new CodeReviewer(
      async (task) => {
        offered = task.tools.map((tool) => tool.name);
        await task.tools.at(-1)!.execute({ findings: [] });
        return END;
      },
      "Review.",
      [reference],
    );
    await reviewer.judge(TEST);
    assert.deepEqual(offered, ["playwright_read", "report_quality"]);
  });

  it("finds nothing in a test it reports nothing of, and throws when its session ends without a report", async () => {
    const quiet = new CodeReviewer(async (task) => {
      await task.tools[0]!.execute({});
      return END;
    }, "Review.");
    assert.deepEqual(await quiet.judge(TEST), []);
    await assert.rejects(new CodeReviewer(async () => END, "Review.").judge(TEST), /the review ended without a report\./);
  });
});
