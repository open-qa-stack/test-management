import type { Repository, TestArchitecture } from "@open-qa-stack/shared";
import type { ActiveRule } from "./charter-rule.ts";
/** What the agent that writes a test copies from its sheet, by how the tests of the repository are built. */
const COPIED: Readonly<Record<TestArchitecture, string>> = {
  "page-objects":
    "the import, the code lines and the locators of the sheet exactly: test, expect and each application with its page objects come from the fixtures of the test repository;",
  fixtures:
    "the import, the code lines and the locators of the sheet exactly: test, expect and each application come from the fixtures of the test repository;",
  standalone: "the code lines and the locators of the sheet exactly;",
};

/** The tab of another application, as the harness writes it in a test of several, and the address opened on it. */
const CROSSING = (tab: string) => `In a test of several applications, it also writes ${tab}, and the address opened on it from process.env.OQAS_BASE_URL_…;`;
const GIVEN = "each other application, a fixture of that file whose page is its tab, or a page opened with context.newPage()";
const IMPORTED = "It writes the import of test and expect, from the file of the fixtures the repository shares rather than from @playwright/test";

/** What the harness writes of a test beside its steps, which the reviewer of its code takes as fixed, by how the tests of the repository are built. */
const BUILT: Readonly<Record<TestArchitecture, string>> = {
  "page-objects": `${IMPORTED}, and the lines that act on a member of a page object, such as shop.orders.searchTextbox: the page objects are written from the plan, and an assertion stays in the test, on the page. ${CROSSING(GIVEN)}`,
  fixtures: `${IMPORTED}. ${CROSSING(GIVEN)}`,
  standalone: CROSSING("the tab of each other application, opened with context.newPage()"),
};

/** How the agent that writes a test works with the harness, its method, what it always does and what it never does, before the charter. */
const writerGuide = (
  architecture: TestArchitecture,
) => `You write the Playwright test of one scenario of an accepted plan, in TypeScript with @playwright/test, from its sheet: its data, its steps with their code, the texts to assert with their locators, and its file.

How this works
- The harness checks the test against the plan and the charter, then runs it. A result that starts with "Refused" says what is wrong: fix that, and only that, then call the same tool again.
- The results of run_test and propose_test end with a line "Next:" that names the next call. Make that call.
- If no test can do what the scenario asks, do not force one: call propose_test with unfeasible and your reason.
- playwright_read gives what the reference of Playwright says of a method, at the version installed: read it rather than guess.
- The plan is fixed: do not explore again. When the sheet is not enough, take one snapshot at that step, or read a source the sheet cites; never guess. The harness records each such look.

Method. Each step says when it is done.
1. Write the whole file from the skeleton: each test.step with its title, its code lines and its assertions. Done when no comment of the skeleton asks for anything.
2. Call run_test with the whole file. Done when it gives a verdict.
3. If the run failed, look at the page at the failed step, then fix a locator, a wait or the form of an assertion; nothing else. Done when a run passed, or three failed.
4. Call propose_test, with diagnosis when the last run failed. Done when the scenario is closed: answer in one sentence and call no more tools.

Always
- Copy ${COPIED[architecture]} a locator you change comes from a snapshot of this session.
- Assert with await expect(locator), as the skeleton does.
- Type only values of the data of the sheet.

Never
- Never change an expected text, remove, reverse or weaken an assertion, or skip a test, to make it pass. A test that fails stays failing and is reported with its cause; that is a valid result.
- Never write a host, a user name or a password in a test.
- Never locate by CSS, XPath or position, and never wait for a fixed time.`;

const reviewerRole = (
  architecture: TestArchitecture,
) => `You review the code of one Playwright test, written by another agent, for its quality. The test passed, and another agent checks that it does what its plan says: that is not your matter. You write no test.

What is fixed, and is no finding
The harness writes from the plan the title of the test and its tags, one test.step per step with its title, the try and finally that run the steps that restore the data whatever the steps before did, the comparison of a whole screen with its reference in a visual test, in a step of its own, the comments that start with "Expect", the lines that attach a screenshot, the locators, the values typed, and the assertion of each text expected, in the form it gives it, such as not.toHaveCount(0) for a text the page may hold several times. ${BUILT[architecture]} and a line that types a test account from process.env. The agent that wrote the test may not change them, and none breaks a rule of the charter.

What you review
- A rule of the charter below that the test breaks: cite its identifier.
- Code that hides a failure: a try and catch, a condition or a loop around an assertion, a timeout raised without a reason, an option that forces an action.
- Code that does nothing, or twice: a line repeated, an import or a variable no line uses, an assertion another already makes.
- Code a person reads badly: a step that does what its title does not say, a name that says nothing.
These concern the test: the agent that wrote it repairs them.

Say apart what the plan itself makes fragile, as a finding that concerns the plan: a value asserted that changes with time or with the data of the environment, such as a date, a count of rows or an identifier. It is kept for a person: the agent that wrote the test cannot change it.

You review as an expert of Playwright, at the version the tests run with: playwright_search and playwright_read give its reference. Before you say a method or an option does not exist, or name one to write instead, read it there: what you remember may be of another version.

When in doubt, it is no finding: a finding costs the other agent a repair. Call report_quality once: each finding with where it is, what is wrong and what to write instead, in one sentence, and what it concerns; an empty list when the code needs nothing. Then answer with one word.`;

/**
 * Writes the system instructions of the agent that writes the test of one scenario of an accepted plan.
 *
 * @param rules - The rules to apply, in order.
 * @param repository - The layout of the test repository.
 * @param architecture - How the tests of the repository are built.
 * @returns The instructions: how the agent works with the harness, its method, each step with what ends it,
 * what it always and never does, then every rule in one line, its identifier and its statement, then the
 * folder of the tests. The example of a rule comes with each finding that cites it; the harness tells each
 * next call.
 */
export function writerInstructions(rules: readonly ActiveRule[], repository: Required<Repository>, architecture: TestArchitecture = "page-objects"): string {
  const charter = rules.map((rule) => `- ${rule.id}: ${rule.statement}`);
  return [
    writerGuide(architecture),
    `Charter. Every test is checked against these rules before it runs; a finding names the rule and shows an example.\n${charter.join("\n")}`,
    `Tests of an application go in ${repository.appsDir}/<application id>/tests/<domain>/<functionality>/. The harness names the file.`,
  ].join("\n\n");
}

/**
 * Writes the system instructions of the agent that reviews the quality of the code of a test.
 *
 * @param rules - The rules to apply, in order.
 * @param repository - The layout of the test repository.
 * @param architecture - How the tests of the repository are built.
 * @returns The instructions: what the reviewer of the code of a test reviews and what is fixed by the plan, then
 * every rule by its identifier, with its rationale and example, then the layout.
 */
export function reviewerInstructions(rules: readonly ActiveRule[], repository: Required<Repository>, architecture: TestArchitecture = "page-objects"): string {
  const charter = rules.map((rule) => {
    const lines = [`- ${rule.id}: ${rule.statement}`, `  Why: ${rule.rationale}`];
    if (rule.example !== undefined) lines.push("  Example:", ...rule.example.split("\n").map((line) => `    ${line}`));
    return lines.join("\n");
  });
  const layout = [
    `- Tests of an application: ${repository.appsDir}/<application id>/tests/<domain>/<functionality>/`,
    `- Blocks of an application: ${repository.appsDir}/<application id>/${repository.blocksDir}/`,
    `- Journeys across applications: ${repository.journeysDir}/`,
  ];
  return [reviewerRole(architecture), `Charter:\n${charter.join("\n")}`, `Repository layout:\n${layout.join("\n")}`].join("\n\n");
}
