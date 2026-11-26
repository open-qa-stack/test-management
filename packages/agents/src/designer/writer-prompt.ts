import type { Account, Application, TestArchitecture } from "@open-qa-stack/domain";
import { PLAYWRIGHT_READ_TOOL } from "@open-qa-stack/tools";
import { promptOf, type PromptTemplate, type PromptValues } from "../common/prompt-template.ts";
import { PROPOSE_TOOL, RUN_TOOL } from "./test-proposals.ts";

/** What the agent that writes a test copies from its sheet, by how the tests of the repository are built. */
const COPIED: Readonly<Record<TestArchitecture, string>> = {
  "page-objects":
    "the import, the code lines and the locators of the sheet exactly: test, expect and each application with its page objects come from the fixtures of the test repository;",
  fixtures:
    "the import, the code lines and the locators of the sheet exactly: test, expect and each application come from the fixtures of the test repository;",
  standalone: "the code lines and the locators of the sheet exactly;",
};

/**
 * The prompt of the agent that writes a test: how it works with the harness, its method, what it always does and what
 * it never does, with what it copies from its sheet and the tools it names. The charter follows it.
 */
export const WRITER_PROMPT = {
  template: `You write the Playwright test of one scenario of an accepted plan, in TypeScript with @playwright/test, from its sheet: its data, its steps with their code, the texts to assert with their locators, and its file.

How this works
- The harness checks the test against the plan and the charter, then runs it. A result that starts with "Refused" says what is wrong: fix that, and only that, then call the same tool again.
- The results of {{run_tool}} and {{propose_tool}} end with a line "Next:" that names the next call. Make that call.
- If no test can do what the scenario asks, do not force one: call {{propose_tool}} with unfeasible and your reason.
- {{playwright_read_tool}} gives what the reference of Playwright says of a method, at the version installed: read it rather than guess.
- The plan is fixed: do not explore again. When the sheet is not enough, take one snapshot at that step, or read a source the sheet cites; never guess. The harness records each such look.

Method. Each step says when it is done.
1. Write the whole file from the skeleton: each test.step with its title, its code lines and its assertions. Done when no comment of the skeleton asks for anything.
2. Call {{run_tool}} with the whole file. Done when it gives a verdict.
3. If the run failed, look at the page at the failed step, then fix a locator, a wait or the form of an assertion; nothing else. Done when a run passed, or three failed.
4. Call {{propose_tool}}, with diagnosis when the last run failed. Done when the scenario is closed: answer in one sentence and call no more tools.

Always
- Copy {{copied}} a locator you change comes from a snapshot of this session.
- Assert with await expect(locator), as the skeleton does.
- Type only values of the data of the sheet.

Never
- Never change an expected text, remove, reverse or weaken an assertion, or skip a test, to make it pass. A test that fails stays failing and is reported with its cause; that is a valid result.
- Never write a host, a user name or a password in a test.
- Never locate by CSS, XPath or position, and never wait for a fixed time.`,
  variables: ["run_tool", "propose_tool", "playwright_read_tool", "copied"],
} as const satisfies PromptTemplate;

/**
 * What each variable of the prompt of the writer of a test stands for in a session.
 *
 * @param architecture - How the tests of the repository are built.
 * @returns The value of each variable.
 */
export function writerValues(architecture: TestArchitecture): PromptValues<typeof WRITER_PROMPT> {
  return {
    run_tool: RUN_TOOL,
    propose_tool: PROPOSE_TOOL,
    playwright_read_tool: PLAYWRIGHT_READ_TOOL,
    copied: COPIED[architecture],
  };
}

/**
 * Writes the part of the system instructions of the agent that writes a test that is its own, before the charter.
 *
 * @param architecture - How the tests of the repository are built.
 * @returns The prompt of the agent, for that architecture.
 */
export function writerInstructions(architecture: TestArchitecture): string {
  return promptOf(WRITER_PROMPT, writerValues(architecture));
}

/** A test the repository has that the session repairs: its file, and its text now. */
export interface RepairedTest {
  /** Its path, relative to the root of the test repository. */
  readonly path: string;
  /** Its text, as the file holds it. */
  readonly content: string;
}

/**
 * Writes the request that starts the session of one scenario: how its test signs in, the packages it may
 * import, then the sheet of the scenario, which is all the session is given of the plan. A session that
 * repairs a test the repository has is given the text of its file first, which it runs before it changes it.
 *
 * @param sheet - The sheet of the scenario, which ends with the next call.
 * @param applications - The applications the scenario acts on, its own first: each tells how its test signs in to it.
 * @param packages - What a test may import: the fixtures of the test repository and its packages.
 * @param environment - The environment the tests run against.
 * @param repaired - The test the session repairs, when it repairs one.
 * @returns The message to send to the agent that writes the test.
 */
export function writeRequest(
  sheet: string,
  applications: readonly Application[],
  packages: readonly string[],
  environment: string,
  repaired?: RepairedTest,
): string {
  return [
    repaired === undefined ? `Write the test of this scenario for the environment ${environment}.` : repairText(repaired, environment),
    `Sign-in: ${signIns(applications, environment)}\nA test may import: ${packages.join(", ")}.`,
    sheet,
  ].join("\n\n");
}

/** How the test of a scenario signs in to the applications it acts on: to each that has accounts, named when it acts on several. */
function signIns(applications: readonly Application[], environment: string): string {
  const signing = applications.flatMap((application) => {
    const accounts = application.authentication.accounts ?? [];
    return accounts.length === 0 ? [] : [{ application, accounts }];
  });
  if (signing.length === 0) return "none.";
  const told = signing.map(({ application, accounts }) => signIn(application, accounts, environment));
  return applications.length === 1 ? told[0]! : signing.map(({ application }, at) => `on ${application.id}, ${told[at]!}`).join(" ");
}

/** How the test of an application signs in: by the lines of its sheet, which read the account from the environment, or by the variables themselves without a user interface. */
function signIn(application: Application, accounts: readonly Account[], environment: string): string {
  const names = `${accounts.length === 1 ? "the account" : "the accounts"} ${accounts.map((account) => account.name).join(", ")}`;
  const screens = application.environments.some((candidate) => candidate.name === environment && candidate.uiUrl !== undefined);
  if (screens) return `with ${names}; the lines of the sheet that sign in read it from process.env: keep them as they are.`;
  return `with ${names}; a test reads ${accounts.map((account) => `process.env.${account.usernameEnv} and process.env.${account.passwordEnv}`).join(", ")}.`;
}

/** What a session that repairs a test is asked first: to run the test as it is, then to fix what fails, in its own file. */
function repairText({ path, content }: RepairedTest, environment: string): string {
  return [
    `Repair the test of this scenario for the environment ${environment}: the repository has it in ${path}, and the person says it fails.`,
    `First call ${RUN_TOOL} with its text as it is, then look at the page where it fails. When the test is at fault, fix it and keep to the scenario below; when the application is, keep the test, and say why when you call ${PROPOSE_TOOL}.`,
    `Its text now:\n\`\`\`ts\n${content.trimEnd()}\n\`\`\``,
  ].join("\n");
}
