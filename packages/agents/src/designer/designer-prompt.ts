import type { Application, DomainIndex, SourceCard } from "@open-qa-stack/shared";
import { MAX_TESTS, MIN_TESTS, PROPOSE_TOOL, RUN_TOOL } from "./test-proposals.ts";
import { TEST_MODULE } from "./spec-rules.ts";

/**
 * Writes the request that starts a design: the rules of a proposal, the applications and how to sign in to
 * them, then the domains of the index, each element with what its card says of it.
 *
 * @param index - The domain index.
 * @param applications - The applications a test may be about.
 * @param cards - The card of each source that has a readable one.
 * @returns The message to send to the designer.
 */
export function designRequest(index: DomainIndex, applications: readonly Application[], cards: ReadonlyMap<string, SourceCard>): string {
  const rules = [
    `- Run each test with ${RUN_TOOL} before you propose it, and fix it until it passes: read the error, the step that failed and, when it helps, the screens and the logs of the services. A test is kept only once it ran: it must pass, unless the application is at fault (see below).`,
    `- Propose each test with ${PROPOSE_TOOL}, one file per call, between ${MIN_TESTS} and ${MAX_TESTS} in all. A test is about one application only.`,
    `- Propose a test that does not pass only when the application, not the test, is at fault, after you ran it: say why in failure, with what the run showed.`,
    `- Import only ${TEST_MODULE}, or a relative path inside the test repository; never another test file.`,
    `- Reach an application with paths relative to its base URL, such as await page.goto("/"); the Playwright configuration gives the base URL. Never write an address or a host.`,
    "- A test that signs in reads its account from the environment variables named below, with process.env; never write a username or a password.",
    "- A test writes no file: no saveAs, storageState, pdf or path option; the runner keeps the traces and screenshots.",
    "- Give the domain of the index the test comes from, and why the test is worth running in one sentence.",
    "- Check a screen with the browser tools before you rely on its labels; leave out what neither the index nor the screens show.",
  ];
  const known = applications.map((application) => `- ${application.id} (${application.name}, ${application.type}): ${signIn(application)}`);
  const summaries = new Map([...cards].flatMap(([source, card]) => card.domains.flatMap((domain) => domain.items.map((item) => [`${source}\n${item.name}`, item.summary] as const))));
  const domains = index.domains.map((domain) => {
    const items = domain.references.flatMap((references) =>
      references.items.map((item) => {
        const summary = summaries.get(`${references.source}\n${item}`);
        return `- ${references.source}: ${item}${summary === undefined ? "" : ` — ${summary}`}`;
      }),
    );
    return [`## ${domain.id}: ${domain.label}`, domain.description, ...items].join("\n");
  });
  return [`Design Playwright tests for the environment ${index.environment}.`, `Rules:\n${rules.join("\n")}`, `Applications:\n${known.join("\n")}`, `Domains of the index:\n\n${domains.join("\n\n")}`].join("\n\n");
}

function signIn(application: Application): string {
  const accounts = application.authentication.accounts ?? [];
  if (accounts.length === 0) return "no sign-in.";
  return `signs in with a form; ${accounts.map((account) => `account ${account.name}: username in process.env.${account.usernameEnv}, password in process.env.${account.passwordEnv}`).join("; ")}.`;
}
