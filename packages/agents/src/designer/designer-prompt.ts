import type { Application } from "@open-qa-stack/shared";
import { scopedToolName } from "@open-qa-stack/tools";
import { ENTRY_TOOL } from "./index-map.ts";
import { PLAN_TOOL } from "./plan-proposal.ts";

/**
 * Writes the request that starts a design: the brief, what the index holds for it, or its domains when
 * nothing of it echoes the brief, the applications and how to sign in to them, the packages a test may
 * import, then the next call.
 *
 * @remarks
 * The rules of a test are not repeated: each is a gate of the harness, told when it refuses, or a line of
 * the system instructions.
 *
 * @param brief - What the developer wants tested, in their own words, if anything.
 * @param environment - The environment the tests run against.
 * @param found - What the index holds for the brief, as `IndexMap.found` gives it; none without a brief.
 * @param domains - The domains of the index, a line each.
 * @param applications - The applications a test may be about.
 * @param packages - The packages a test may import.
 * @returns The message to send to the designer.
 */
export function designRequest(brief: string | undefined, environment: string, found: readonly string[], domains: readonly string[], applications: readonly Application[], packages: readonly string[]): string {
  const asked = brief === undefined ? "No brief was given: design the tests that matter most across the domains below." : `Brief of the developer, in their words:\n<brief>\n${brief}\n</brief>`;
  const known = applications.map((application) => `- ${application.id} (${application.name}, ${application.type}): ${signIn(application, environment)}`);
  const next =
    brief === undefined
      ? `Next: call ${ENTRY_TOOL} on the domains above that matter most, read what they hold, do it once on the screens, then call ${PLAN_TOOL}.`
      : `Next: call ${ENTRY_TOOL} on the elements above that the brief is about, read them, do the brief once on the screens, then call ${PLAN_TOOL}.`;
  return [
    `Design Playwright tests for the environment ${environment}.`,
    asked,
    found.length === 0 ? `Domains of the index:\n${domains.join("\n")}` : `What the index holds for this brief:\n${found.join("\n")}`,
    `Applications:\n${known.join("\n")}`,
    `A test may import: ${packages.join(", ")}.`,
    next,
  ].join("\n\n");
}

/** How a test signs in to an application: with its fill tool, whose result gives the line, or from the environment without a user interface. */
function signIn(application: Application, environment: string): string {
  const accounts = application.authentication.accounts ?? [];
  if (accounts.length === 0) return "no sign-in.";
  const names = `${accounts.length === 1 ? "the account" : "the accounts"} ${accounts.map((account) => account.name).join(", ")}`;
  const screens = application.environments.some((candidate) => candidate.name === environment && candidate.uiUrl !== undefined);
  if (screens) return `sign in with ${scopedToolName(application.id, "fill")} and ${names}; the result gives the line a test writes.`;
  return `sign in with ${names}; a test reads ${accounts.map((account) => `process.env.${account.usernameEnv} and process.env.${account.passwordEnv}`).join(", ")}.`;
}
