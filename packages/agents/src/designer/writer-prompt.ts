import type { Application } from "@open-qa-stack/domain";

/**
 * Writes the request that starts the session of one scenario: how its test signs in, the packages it may
 * import, then the sheet of the scenario, which is all the session is given of the plan.
 *
 * @param sheet - The sheet of the scenario, which ends with the next call.
 * @param application - The application of the scenario.
 * @param packages - What a test may import: the fixtures of the test repository and its packages.
 * @param environment - The environment the tests run against.
 * @returns The message to send to the agent that writes the test.
 */
export function writeRequest(sheet: string, application: Application, packages: readonly string[], environment: string): string {
  return [
    `Write the test of this scenario for the environment ${environment}.`,
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
