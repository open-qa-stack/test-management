import type { Application } from "@open-qa-stack/domain";
import { PROPOSE_TOOL, RUN_TOOL } from "./test-proposals.ts";

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
 * @param application - The application of the scenario.
 * @param packages - What a test may import: the fixtures of the test repository and its packages.
 * @param environment - The environment the tests run against.
 * @param repaired - The test the session repairs, when it repairs one.
 * @returns The message to send to the agent that writes the test.
 */
export function writeRequest(sheet: string, application: Application, packages: readonly string[], environment: string, repaired?: RepairedTest): string {
  return [
    repaired === undefined ? `Write the test of this scenario for the environment ${environment}.` : repairText(repaired, environment),
    `Sign-in: ${signIn(application, environment)}\nA test may import: ${packages.join(", ")}.`,
    sheet,
  ].join("\n\n");
}

/** How the test of an application signs in: by the lines of its sheet, which read the account from the environment, or by the variables themselves without a user interface. */
function signIn(application: Application, environment: string): string {
  const accounts = application.authentication.accounts ?? [];
  if (accounts.length === 0) return "none.";
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
