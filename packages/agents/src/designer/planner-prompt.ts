import type { Application } from "@open-qa-stack/shared";
import { scopedToolName } from "@open-qa-stack/tools";
import { ENTRY_TOOL, FIND_TOOL } from "./index-map.ts";
import { PLAN_TOOL } from "./plan-proposal.ts";

/**
 * System instructions of the agent that plans the tests of a design: what it is for, how the harness
 * answers it, its method, each step with what ends it, and the rules that cause most refusals.
 */
export const PLANNER_INSTRUCTIONS = `You plan the tests of the applications of one test environment. You explore, do each journey once on the screens, then submit one test plan with ${PLAN_TOOL}. Another agent writes each test from your plan alone: it sees nothing of this session.

How this works
- The harness checks the plan. A result that starts with "Refused" says what is wrong: fix that, and only that, then call ${PLAN_TOOL} again.
- A result that starts with "The plan is not accepted yet" asks you, once, about elements the page shows several of: put in accepts the numbers you accept, correct the rest, then call ${PLAN_TOOL} again.
- Each browser tool that opens or acts on a page returns "action", its number. The harness writes the code and the locators of the plan from the actions you cite: you never write a locator.
- When you are not sure, look: read the source, or take a snapshot. Never guess.

Method. Each step says when it is done.
1. Understand the brief. Call ${ENTRY_TOOL} on the elements given with it, and ${FIND_TOOL} for what is missing. Done when you can name the screens and the data the brief is about.
2. Find real data. Read the source that holds it, such as a table or a contract, with the tool ${ENTRY_TOOL} names. Done when each scenario you have in mind has its values, exactly as a tool returned them.
3. Do each journey on the screens, as its test will: open its first address with the goto tool of the application, sign in when the application asks, then fill and click as a user does. Read "appeared" and "gone" after each action. Done when the screens showed you the result of each journey, and what the application answers to an input that matches nothing or is wrong.
4. Call ${PLAN_TOOL}. For each step, give in actions the numbers of the actions that did it, in order; a scenario starts with the action that opened its first address. Done when the plan is accepted: answer in one sentence and call no more tools.

Three rules cause most refusals
- Every value a step types is in the data of its scenario, with the source that showed it, or "made-up" for a value you invent.
- With two functional scenarios or more, one is negative: an input that matches nothing, is wrong or is forbidden, and what the application answers.
- An expected text is what the application answered beside the fields, such as a row, a message or a count; never the value you typed, which its field only echoes.

Keep with remember a fact the agents after you should know, such as a rule or a pitfall of the application.`;

/**
 * Writes the request that starts the session that plans: the brief, what the index holds for it, or its
 * domains when nothing of it echoes the brief, the applications and how to sign in to them, then the next
 * call.
 *
 * @remarks
 * The rules of a plan are not repeated: each is a gate of the harness, told when it refuses, or a line of
 * the system instructions. What only the agent that writes a test needs, such as the packages a test may
 * import, is left to it.
 *
 * @param brief - What the developer wants tested, in their own words, if anything.
 * @param environment - The environment the tests run against.
 * @param found - What the index holds for the brief, as `IndexMap.found` gives it; none without a brief.
 * @param domains - The domains of the index, a line each.
 * @param applications - The applications a test may be about.
 * @returns The message to send to the agent that plans.
 */
export function planRequest(
  brief: string | undefined,
  environment: string,
  found: readonly string[],
  domains: readonly string[],
  applications: readonly Application[],
): string {
  const asked =
    brief === undefined
      ? "No brief was given: plan the tests that matter most across the domains below."
      : `Brief of the developer, in their words:\n<brief>\n${brief}\n</brief>`;
  const next =
    brief === undefined
      ? `Next: call ${ENTRY_TOOL} on the domains above that matter most, read what they hold, do it once on the screens, then call ${PLAN_TOOL}.`
      : `Next: call ${ENTRY_TOOL} on the elements above that the brief is about, read them, do the brief once on the screens, then call ${PLAN_TOOL}.`;
  const known = applications.map((application) => `- ${application.id} (${application.name}, ${application.type}): ${signIn(application, environment)}`);
  return [
    `Plan Playwright tests for the environment ${environment}.`,
    asked,
    found.length === 0 ? `Domains of the index:\n${domains.join("\n")}` : `What the index holds for this brief:\n${found.join("\n")}`,
    `Applications:\n${known.join("\n")}`,
    next,
  ].join("\n\n");
}

/** How the agent signs in to an application while it explores: with its fill tool and the name of an account, never a credential. */
function signIn(application: Application, environment: string): string {
  const accounts = application.authentication.accounts ?? [];
  if (accounts.length === 0) return "no sign-in.";
  const names = `${accounts.length === 1 ? "the account" : "the accounts"} ${accounts.map((account) => account.name).join(", ")}`;
  const screens = application.environments.some((candidate) => candidate.name === environment && candidate.uiUrl !== undefined);
  return screens ? `sign in with ${scopedToolName(application.id, "fill")} and ${names}.` : `no screens; its tests sign in with ${names}.`;
}
