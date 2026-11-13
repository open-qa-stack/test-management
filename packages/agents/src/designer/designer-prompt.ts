import type { Application } from "@open-qa-stack/shared";
import { ENTRY_TOOL, FIND_TOOL } from "./index-map.ts";
import { PLAN_TOOL } from "./plan-proposal.ts";
import { MAX_TESTS, MIN_TESTS, PROPOSE_TOOL, RUN_TOOL } from "./test-proposals.ts";

/**
 * Writes the request that starts a design: the brief, the way to go from it to the tests, the rules of a
 * test, the applications and how to sign in to them, then the domains of the index.
 *
 * @param brief - What the developer wants tested, in their own words, if anything.
 * @param environment - The environment the tests run against.
 * @param domains - The domains of the index, a line each.
 * @param applications - The applications a test may be about.
 * @param packages - The packages a test may import.
 * @returns The message to send to the designer.
 */
export function designRequest(brief: string | undefined, environment: string, domains: readonly string[], applications: readonly Application[], packages: readonly string[]): string {
  const asked = brief === undefined ? "No brief was given: design the tests that matter most across the domains of the index." : `The brief of the developer, in their words:\n<brief>\n${brief}\n</brief>`;
  const steps = [
    `1. Find what echoes the brief with ${FIND_TOOL} and ${ENTRY_TOOL}: the domains, then the sections of documents, operations, tables, folders and screens, with the tools that read them. The index is a map, not a limit: look beyond it when it falls short.`,
    "2. Read what matters with the tools of each source, or search it for a precise element: the rules, the fields, the data the application holds. The bases are read only.",
    "3. Explore the screens the brief is about with the browser tools: what they show, how a search or a form behaves, with which data.",
    `4. Submit the plan with ${PLAN_TOOL}: between ${MIN_TESTS} and ${MAX_TESTS} scenarios, each verifying a behaviour the brief aims at — a search that finds, a detail that shows the right data, a rule that applies — not only that a screen displays. Cite the sources each relies on.`,
    `5. Once the plan is accepted, write the test of each scenario, run it with ${RUN_TOOL} and fix it until it passes, then propose it with ${PROPOSE_TOOL}, naming its scenario and copying the assertion that verifies its expected result.`,
  ];
  const rules = [
    `- A test is kept only once it ran: it must pass, unless the application is at fault. Read the error, the step that failed and, when it helps, the screens and the logs of the services.`,
    `- Propose each test with ${PROPOSE_TOOL}, one file per call, between ${MIN_TESTS} and ${MAX_TESTS} in all. A test is about one application only.`,
    `- Propose a test that does not pass only when the application, not the test, is at fault, after you ran it: say why in failure, with what the run showed.`,
    "- Rely on what you read or saw, never on what you suppose: expect only texts, labels and data the sources or the screens showed you.",
    "- Each test verifies the expected result of its scenario: after the action, it asserts what the action produced — the rows a search finds, the fields a detail shows, with values you saw. That a field or a button is visible verifies no functional scenario.",
    "- Never weaken a test to make it pass. When it fails, find out why with the browser tools, then fix it and keep what it verifies; propose it failing only when the application is at fault.",
    "- Compare a screenshot only in a visual scenario; check data with assertions on texts and values.",
    "- A test may create, change or delete data of the application in this test environment, as long as it relies on no data written before it: it makes what it needs itself.",
    `- Import only the packages of the test repository (${packages.join(", ")}), or a relative path inside it; never another test file.`,
    "- A visual test compares a page with its reference, with await expect(page).toHaveScreenshot(); the reference is made at its first run and kept with the test.",
    `- Reach an application with paths relative to its base URL, such as await page.goto("/"); the Playwright configuration gives the base URL. Never write an address or a host.`,
    "- A test that signs in reads its account from the environment variables named below, with process.env; never write a username or a password.",
    "- A test writes no file: no saveAs, storageState, pdf or path option; the runner keeps the traces and screenshots.",
    "- Give the domain of the index the test comes from, and why the test is worth running in one sentence.",
  ];
  const known = applications.map((application) => `- ${application.id} (${application.name}, ${application.type}): ${signIn(application)}`);
  return [
    `Design Playwright tests for the environment ${environment}.`,
    asked,
    `How to go about it:\n${steps.join("\n")}`,
    `Rules:\n${rules.join("\n")}`,
    `Applications:\n${known.join("\n")}`,
    `Domains of the index:\n${domains.join("\n")}`,
  ].join("\n\n");
}

function signIn(application: Application): string {
  const accounts = application.authentication.accounts ?? [];
  if (accounts.length === 0) return "no sign-in.";
  return `signs in with a form; ${accounts.map((account) => `account ${account.name}: username in process.env.${account.usernameEnv}, password in process.env.${account.passwordEnv}`).join("; ")}.`;
}
