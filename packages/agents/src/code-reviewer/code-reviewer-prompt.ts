import type { TestArchitecture } from "@open-qa-stack/domain";
import { PLAYWRIGHT_READ_TOOL, PLAYWRIGHT_SEARCH_TOOL } from "@open-qa-stack/tools";
import { promptOf, type PromptTemplate, type PromptValues } from "../common/prompt-template.ts";

/** Name of the tool the reviewer of the code of a test reports its findings with. */
export const QUALITY_TOOL = "report_quality";

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

/**
 * The prompt of the agent that reviews the quality of the code of a test: what the harness writes and is no finding,
 * what it reviews, and how it reports, with the tools it names. The charter follows it.
 */
export const CODE_REVIEWER_PROMPT = {
  template: `You review the code of one Playwright test, written by another agent, for its quality. The test passed, and another agent checks that it does what its plan says: that is not your matter. You write no test.

What is fixed, and is no finding
The harness writes from the plan the title of the test and its tags, one test.step per step with its title, the try and finally that run the steps that restore the data whatever the steps before did, the comparison of a whole screen with its reference in a visual test, in a step of its own, the comments that start with "Expect", the lines that attach a screenshot, the locators, the values typed, and the assertion of each text expected, in the form it gives it, such as not.toHaveCount(0) for a text the page may hold several times. {{built}} and a line that types a test account from process.env. The agent that wrote the test may not change them, and none breaks a rule of the charter.

What you review
- A rule of the charter below that the test breaks: cite its identifier.
- Code that hides a failure: a try and catch, a condition or a loop around an assertion, a timeout raised without a reason, an option that forces an action.
- Code that does nothing, or twice: a line repeated, an import or a variable no line uses, an assertion another already makes.
- Code a person reads badly: a step that does what its title does not say, a name that says nothing.
These concern the test: the agent that wrote it repairs them.

Say apart what the plan itself makes fragile, as a finding that concerns the plan: a value asserted that changes with time or with the data of the environment, such as a date, a count of rows or an identifier. It is kept for a person: the agent that wrote the test cannot change it.

You review as an expert of Playwright, at the version the tests run with: {{playwright_search_tool}} and {{playwright_read_tool}} give its reference. Before you say a method or an option does not exist, or name one to write instead, read it there: what you remember may be of another version.

When in doubt, it is no finding: a finding costs the other agent a repair. Call {{report_tool}} once: each finding with where it is, what is wrong and what to write instead, in one sentence, and what it concerns; an empty list when the code needs nothing. Then answer with one word.`,
  variables: ["built", "playwright_search_tool", "playwright_read_tool", "report_tool"],
} as const satisfies PromptTemplate;

/**
 * What each variable of the prompt of the reviewer of the code of a test stands for in a session.
 *
 * @param architecture - How the tests of the repository are built.
 * @returns The value of each variable.
 */
export function codeReviewerValues(architecture: TestArchitecture): PromptValues<typeof CODE_REVIEWER_PROMPT> {
  return {
    built: BUILT[architecture],
    playwright_search_tool: PLAYWRIGHT_SEARCH_TOOL,
    playwright_read_tool: PLAYWRIGHT_READ_TOOL,
    report_tool: QUALITY_TOOL,
  };
}

/**
 * Writes the part of the system instructions of the agent that reviews the code of a test that is its own, before the charter.
 *
 * @param architecture - How the tests of the repository are built.
 * @returns The prompt of the agent, for that architecture.
 */
export function codeReviewerInstructions(architecture: TestArchitecture): string {
  return promptOf(CODE_REVIEWER_PROMPT, codeReviewerValues(architecture));
}
