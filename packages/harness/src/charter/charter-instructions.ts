import type { Repository } from "@open-qa-stack/shared";
import type { ActiveRule } from "./charter-rule.ts";
/** How the agent that writes a test works with the harness, its method, what it always does and what it never does, before the charter. */
const WRITER_GUIDE = `You write the Playwright test of one scenario of an accepted plan, in TypeScript with @playwright/test, from its sheet: its data, its steps with their code, the texts to assert with their locators, and its file.

How this works
- The harness checks the test against the plan and the charter, then runs it. A result that starts with "Refused" says what is wrong: fix that, and only that, then call the same tool again.
- The results of run_test and propose_test end with a line "Next:" that names the next call. Make that call.
- If no test can do what the scenario asks, do not force one: call propose_test with unfeasible and your reason.
- The plan is fixed: do not explore again. When the sheet is not enough, take one snapshot at that step, or read a source the sheet cites; never guess. The harness records each such look.

Method. Each step says when it is done.
1. Write the whole file from the skeleton: each test.step with its title, its code lines and its assertions. Done when no comment of the skeleton asks for anything.
2. Call run_test with the whole file. Done when it gives a verdict.
3. If the run failed, look at the page at the failed step, then fix a locator, a wait or the form of an assertion; nothing else. Done when a run passed, or three failed.
4. Call propose_test, with diagnosis when the last run failed. Done when the scenario is closed: answer in one sentence and call no more tools.

Always
- Copy the code lines and the locators of the sheet exactly; a locator you change comes from a snapshot of this session.
- Assert with await expect(locator), as the skeleton does.
- Type only values of the data of the sheet.

Never
- Never change an expected text, remove, reverse or weaken an assertion, or skip a test, to make it pass. A test that fails stays failing and is reported with its cause; that is a valid result.
- Never write a host, a user name or a password in a test.
- Never locate by CSS, XPath or position, and never wait for a fixed time.`;

const REVIEWER_ROLE = `You are the test reviewer of a test platform. You review the Playwright tests the designer proposes against the charter below. For each rule a test breaks, cite the identifier of the rule, exactly as listed, and the line that breaks it. A test that breaks no rule is accepted.`;

/**
 * Writes the system instructions of the agent that writes the test of one scenario of an accepted plan.
 *
 * @param rules - The rules to apply, in order.
 * @param repository - The layout of the test repository.
 * @returns The instructions: how the agent works with the harness, its method, each step with what ends it,
 * what it always and never does, then every rule in one line, its identifier and its statement, then the
 * folder of the tests. The example of a rule comes with each finding that cites it; the harness tells each
 * next call.
 */
export function writerInstructions(rules: readonly ActiveRule[], repository: Required<Repository>): string {
  const charter = rules.map((rule) => `- ${rule.id}: ${rule.statement}`);
  return [
    WRITER_GUIDE,
    `Charter. Every test is checked against these rules before it runs; a finding names the rule and shows an example.\n${charter.join("\n")}`,
    `Tests of an application go in ${repository.appsDir}/<application id>/. The harness names the file.`,
  ].join("\n\n");
}

/**
 * Writes the system instructions of the test reviewer.
 *
 * @param rules - The rules to apply, in order.
 * @param repository - The layout of the test repository.
 * @returns The instructions: the role, then every rule by its identifier, with its rationale and example,
 * then the layout.
 */
export function reviewerInstructions(rules: readonly ActiveRule[], repository: Required<Repository>): string {
  const charter = rules.map((rule) => {
    const lines = [`- ${rule.id}: ${rule.statement}`, `  Why: ${rule.rationale}`];
    if (rule.example !== undefined) lines.push("  Example:", ...rule.example.split("\n").map((line) => `    ${line}`));
    return lines.join("\n");
  });
  const layout = [
    `- Tests of an application: ${repository.appsDir}/<application id>/`,
    `- Blocks of an application: ${repository.appsDir}/<application id>/${repository.blocksDir}/`,
    `- Journeys across applications: ${repository.journeysDir}/`,
  ];
  return [REVIEWER_ROLE, `Charter:\n${charter.join("\n")}`, `Repository layout:\n${layout.join("\n")}`].join("\n\n");
}
