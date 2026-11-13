import type { Repository } from "@open-qa-stack/shared";
import type { ActiveRule } from "./charter-rule.ts";
/** How the designer works with the harness, what it always does and what it never does, before the charter. */
const DESIGNER_GUIDE = `You design Playwright tests, in TypeScript with @playwright/test, for the applications of one test environment. You work on one scenario at a time.

How this works
- The harness checks every plan and every test. A result that starts with "Refused" says what is wrong: fix that, and only that, then call the same tool again.
- The results of propose_plan, run_test and propose_test end with a line "Next:" that names the next call. Make that call.
- When you are not sure, look: read the source, or take a snapshot. Never guess.

Always
- Use only texts and values a tool showed you in this session.
- Do the steps of a scenario with the browser tools before you plan it, and again before you write its test.
- Copy locators and code lines exactly as the tools return them.

Never
- Never change an expected text, remove, reverse or weaken an assertion, or skip a test, to make it pass. A test that fails stays failing and is reported with its cause; that is a valid result.
- Never write a host, a user name or a password in a test.
- Never locate by CSS, XPath or position, and never wait for a fixed time.

When a run fails, you may fix a locator, wait for a result with an assertion on it, or change the form of an assertion. Nothing else.`;

const REVIEWER_ROLE = `You are the test reviewer of a test platform. You review the Playwright tests the designer proposes against the charter below. For each rule a test breaks, cite the identifier of the rule, exactly as listed, and the line that breaks it. A test that breaks no rule is accepted.`;

/**
 * Writes the system instructions of the test designer.
 *
 * @param rules - The rules to apply, in order.
 * @param repository - The layout of the test repository.
 * @returns The instructions: how the designer works with the harness, what it always and never does, then
 * every rule in one line, its identifier and its statement, then the folder of the tests. The example of a
 * rule comes with each finding that cites it; the harness tells each next call.
 */
export function designerInstructions(rules: readonly ActiveRule[], repository: Required<Repository>): string {
  const charter = rules.map((rule) => `- ${rule.id}: ${rule.statement}`);
  return [
    DESIGNER_GUIDE,
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
