import type { TestPlan } from "@open-qa-stack/domain";
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
export function designRequest(
  brief: string | undefined,
  environment: string,
  found: readonly string[],
  domains: readonly string[],
  applications: readonly Application[],
  packages: readonly string[],
): string {
  const asked =
    brief === undefined
      ? "No brief was given: design the tests that matter most across the domains below."
      : `Brief of the developer, in their words:\n<brief>\n${brief}\n</brief>`;
  const next =
    brief === undefined
      ? `Next: call ${ENTRY_TOOL} on the domains above that matter most, read what they hold, do it once on the screens, then call ${PLAN_TOOL}.`
      : `Next: call ${ENTRY_TOOL} on the elements above that the brief is about, read them, do the brief once on the screens, then call ${PLAN_TOOL}.`;
  return [
    `Design Playwright tests for the environment ${environment}.`,
    asked,
    found.length === 0 ? `Domains of the index:\n${domains.join("\n")}` : `What the index holds for this brief:\n${found.join("\n")}`,
    ...reach(applications, packages, environment),
    next,
  ].join("\n\n");
}

/** A test kept by an earlier session of a design, with its text. */
export interface KeptTest {
  /** Path of the file, relative to the test repository. */
  readonly path: string;
  /** Identifier of its scenario. */
  readonly scenario: string;
  /** The verdict of its last run. */
  readonly verdict: string;
  /** Text of the file. */
  readonly content: string;
}

/**
 * Writes the request that goes on with a design a limit stopped: the brief, the accepted plan, which stays,
 * the tests kept and the scenarios closed without one, the applications, the packages a test may import,
 * then the sheet of the scenario open.
 *
 * @param design - What the earlier sessions left: the environment, the brief if any, the plan, the tests kept, the scenarios closed without a test.
 * @param applications - The applications a test may be about.
 * @param packages - The packages a test may import.
 * @param sheet - The sheet of the scenario open, which ends with the next call.
 * @returns The message to send to the designer.
 */
export function resumeRequest(
  design: {
    readonly environment: string;
    readonly brief?: string;
    readonly plan: TestPlan;
    readonly tests: readonly KeptTest[];
    readonly unwritten: readonly string[];
  },
  applications: readonly Application[],
  packages: readonly string[],
  sheet: string,
): string {
  const kept = design.tests.map((test) => `- ${test.path}, for ${test.scenario}: ${test.verdict}.\n\`\`\`ts\n${test.content.trimEnd()}\n\`\`\``);
  return [
    `Go on with the design of Playwright tests for the environment ${design.environment}: a limit stopped it before its end.`,
    ...(design.brief === undefined ? [] : [`Brief of the developer, in their words:\n<brief>\n${design.brief}\n</brief>`]),
    `The accepted plan, which stays as it is; do not submit another:\n${JSON.stringify(design.plan)}`,
    kept.length === 0 ? "No test is kept yet." : `The tests kept, which stay as they are:\n${kept.join("\n")}`,
    ...(design.unwritten.length === 0 ? [] : [`Closed without a test: ${design.unwritten.join(", ")}.`]),
    ...reach(applications, packages, design.environment),
    sheet,
  ].join("\n\n");
}

/** The applications and how to sign in to them, then the packages a test may import. */
function reach(applications: readonly Application[], packages: readonly string[], environment: string): string[] {
  const known = applications.map((application) => `- ${application.id} (${application.name}, ${application.type}): ${signIn(application, environment)}`);
  return [`Applications:\n${known.join("\n")}`, `A test may import: ${packages.join(", ")}.`];
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
