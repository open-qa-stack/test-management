import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DEFAULT_REPOSITORY, type TestArchitecture } from "@open-qa-stack/domain";
import { resolveCharter, writerCharter } from "@open-qa-stack/harness";
import { AGENT_PROMPTS } from "../src/common/agent-prompts.ts";
import { promptOf } from "../src/common/prompt-template.ts";
import { codeReviewerInstructions } from "../src/code-reviewer/code-reviewer-prompt.ts";
import { writerInstructions } from "../src/designer/writer-prompt.ts";

const ARCHITECTURES: readonly TestArchitecture[] = ["page-objects", "fixtures", "standalone"];

describe("the prompts of the agents", () => {
  for (const [agent, prompt] of Object.entries(AGENT_PROMPTS)) {
    it(`declares what the prompt of ${agent} holds between braces, and nothing else`, () => {
      const written = new Set([...prompt.template.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]!));
      assert.deepEqual([...written].sort(), [...prompt.variables].sort());
      assert.doesNotMatch(prompt.template, /\$\{|[ \t]$/m);
    });
  }

  it("writes each variable wherever the prompt names it, and leaves a name it does not declare as it is", () => {
    const prompt = { template: "Call {{tool}}, then {{tool}} again, never {{other}}: $& {{ tool }}.", variables: ["tool"] } as const;
    assert.equal(promptOf(prompt, { tool: "submit_$&" }), "Call submit_$&, then submit_$& again, never {{other}}: $& {{ tool }}.");
  });
});

describe("the prompt of the writer", () => {
  it("says how the harness works, a method whose every step says when it is done, three things to always do and three never to do, and stays out of the reviewer's", () => {
    const instructions = writerInstructions("page-objects");
    assert.deepEqual(
      instructions.split("\n\n").map((section) => section.split("\n")[0]),
      [
        "You write the Playwright test of one scenario of an accepted plan, in TypeScript with @playwright/test, from its sheet: its data, its steps with their code, the texts to assert with their locators, and its file.",
        "How this works",
        "Method. Each step says when it is done.",
        "Always",
        "Never",
      ],
    );
    const lines = (heading: string) => instructions.split(`\n\n${heading}\n`)[1]!.split("\n\n")[0]!.split("\n");
    assert.equal(lines("How this works").length, 5);
    for (const heading of ["Always", "Never"]) assert.equal(lines(heading).length, 3);
    assert.deepEqual(
      lines("Method. Each step says when it is done.").map((step) => /^\d\. .* Done when [^.]+[.:]/.test(step)),
      [true, true, true, true],
    );
    assert.match(instructions, /^- Never change an expected text, remove, reverse or weaken an assertion, or skip a test, to make it pass\./m);
    assert.match(instructions, /^- The plan is fixed: do not explore again\./m);
    assert.match(instructions, /The results of run_test and propose_test end with a line "Next:"/);
    assert.match(instructions, /^- playwright_read gives what the reference of Playwright says of a method/m);
    assert.doesNotMatch(instructions, /cite its identifier|\{\{/);
    assert.ok(!codeReviewerInstructions("page-objects").includes("How this works"));
  });

  it("says what a test copies from its sheet by how the tests of the repository are built", () => {
    const copied = ARCHITECTURES.map((architecture) => /^- Copy (.*) a locator you change/m.exec(writerInstructions(architecture))![1]);
    assert.match(copied[0]!, /each application with its page objects come from the fixtures of the test repository;$/);
    assert.match(copied[1]!, /test, expect and each application come from the fixtures of the test repository;$/);
    assert.equal(copied[2], "the code lines and the locators of the sheet exactly;");
  });

  it("is short enough for a small model, with the charter that follows it", () => {
    const charter = resolveCharter({ disable: [], add: [] });
    assert.ok(charter.ok);
    const whole = `${writerInstructions("page-objects")}\n\n${writerCharter(charter.rules, DEFAULT_REPOSITORY)}`;
    assert.ok(whole.length <= 4300, String(whole.length));
  });
});

describe("the prompt of the reviewer of the code of a test", () => {
  it("asks it to cite the rule a test breaks, and tells it what the plan fixed, what concerns the plan and how it reports", () => {
    const reviewer = codeReviewerInstructions("page-objects");
    for (const said of [
      "A rule of the charter below that the test breaks: cite its identifier.",
      "What is fixed, and is no finding",
      "not.toHaveCount(0)",
      "context.newPage()",
      "process.env.OQAS_BASE_URL_",
      "none breaks a rule of the charter",
      "a finding that concerns the plan",
      "playwright_search and playwright_read give its reference",
      "what you remember may be of another version",
      "When in doubt, it is no finding",
      "Call report_quality once",
    ])
      assert.ok(reviewer.includes(said), said);
    assert.doesNotMatch(reviewer, /\{\{/);
  });

  it("says what the harness writes of a test by how the tests of the repository are built", () => {
    const [pages, fixtures, standalone] = ARCHITECTURES.map(codeReviewerInstructions);
    assert.match(pages!, /It writes the import of test and expect, .* and the lines that act on a member of a page object/);
    assert.match(fixtures!, /It writes the import of test and expect/);
    assert.doesNotMatch(fixtures!, /a member of a page object/);
    assert.doesNotMatch(standalone!, /It writes the import of test and expect/);
    assert.match(standalone!, /the tab of each other application, opened with context\.newPage\(\)/);
  });
});
