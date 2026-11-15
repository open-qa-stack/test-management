import type { ScenarioLevel } from "@open-qa-stack/domain";
import { TESTS_LIST_TOOL } from "./existing-tests.ts";
import type { Application } from "@open-qa-stack/shared";
import { scopedToolName } from "@open-qa-stack/tools";
import { DOMAIN_TOOL, LIST_TOOL, READ_TOOL } from "./index-map.ts";
import { PLAN_TOOL } from "./plan-proposal.ts";

/**
 * System instructions of the agent that plans the tests of a design: what it is for, how the harness
 * answers it, its method, each step with what ends it, and the rules that cause most refusals.
 */
export const PLANNER_INSTRUCTIONS = `You plan the tests of the applications of one test environment. You explore, do each journey once on the screens, then submit the scenarios of one test plan with ${PLAN_TOOL}. Another agent writes each test from your plan alone: it sees nothing of this session.

How this works
- The harness checks the plan. A result that starts with "Refused" says what is wrong: fix that, and only that, then call ${PLAN_TOOL} again.
- A result that starts with "The plan is not closed yet" kept your scenarios and asks what the brief still needs: call ${PLAN_TOOL} with only the scenarios to add. Once every case of the brief has its scenario, say so: call ${PLAN_TOOL} with "scenarios": [], which closes the plan.
- A scenario that verifies what another already does is set aside as a duplicate, and you are told which and why. Never submit the same test under other words: when nothing new is left to verify, close the plan.
- A result that starts with "The plan is not accepted yet" asks you, once, about elements the page shows several of: put in accepts the numbers you accept, correct the rest, then call ${PLAN_TOOL} again.
- Each browser tool that opens or acts on a page returns "action", its number. The harness writes the code and the locators of the plan from the actions you cite: you never write a locator.
- When you are not sure, look: read the source, or take a snapshot. Never guess.

Method. Each step says when it is done.
1. Understand the brief. Call ${DOMAIN_TOOL} on its domain, then with a source for what it says of it; ${LIST_TOOL} finds an element by words, ${READ_TOOL} gives one. Then call ${TESTS_LIST_TOOL} for what the repository already tests about it: plan what no test verifies yet. Done when you can name the screens and the data the brief is about, and the tests that exist.
2. Find real data. Read the source that holds it, such as a table or a contract, with the tool ${DOMAIN_TOOL} names for it. Done when each scenario you have in mind has its values, exactly as a tool returned them.
3. Do each journey on the screens, as its test will: open its first address with the goto tool of the application, sign in when the application asks, then fill and click as a user does. Read "appeared" and "gone" after each action. Done when the screens showed you the result of each journey, and what the application answers to an input that matches nothing or is wrong.
4. Call ${PLAN_TOOL}. For each step, give in actions the numbers of the actions that did it, in order; a scenario starts with the action that opened its first address. Explore again for a scenario to add when you need to. Done when the plan is accepted: answer in one sentence and call no more tools.

The pyramid of tests. Each scenario has a level, and the request says which are asked.
- smoke: the application answers. One step: open its first address, expect one text of the page.
- functional: one behaviour of one screen, and a scenario for each: a search by first name, by last name, with a joker, that matches nothing are four scenarios.
- business: a whole journey through several screens ends as it must, such as signing in, searching a customer and opening their profile.
- cross-application: an action in one application has its effect in another. Do the action with the tools of the first, open an address of the second with its goto tool, check the effect there, and cite the actions of both, in order.
- end-to-end: the same through three applications or more.
Plan at each level asked what the brief calls for: many small functional scenarios, and a business one for each journey.

Data. A scenario says whether it only reads the data of the environment or writes some. Every test and every user share that data, and a test that writes is run twice in a row: it must pass both times. So enter data of your own, such as a made-up name, or put back what you changed, in a step that says it restores and starts by opening an address, and on the screens too — what you change while you explore stays changed. A test runs the step that restores even when an earlier step failed.

Three rules cause most refusals
- Every value a step types is in the data of its scenario, with the source that showed it, or "made-up" for a value you invent.
- With two functional scenarios or more, one is negative: an input that matches nothing, is wrong or is forbidden, and what the application answers.
- An expected text is what the application answered beside the fields, such as a row, a message or a count; never the value you typed, which its field only echoes.

Cover the brief: each business rule, each information and each behaviour it is about has a scenario that verifies it. Say in uncovered what no scenario covers and why — the application does not allow it, or the plan has no room for it; never plan another test in its place without a word. When no test can do anything the brief asks, plan none: call ${PLAN_TOOL} with "scenarios": [] and uncovered, which says what the brief asks and why.

Keep with remember a fact the agents after you should know, such as a rule or a pitfall of the application.`;

/** What a plan of one level alone makes of a brief, whatever the brief asks as a whole. */
const LEVEL_READINGS: Readonly<Record<ScenarioLevel, string>> = {
  smoke:
    "At this level the brief only names the applications it is about: plan, for each, one scenario of one step that opens its first address and expects one text of the page. The brief itself is not done here. Leave no application of the brief without its scenario.",
  functional:
    "At this level, take the screens the brief goes through one at a time. For each, plan many small scenarios, one for each behaviour of that screen: each rule of a form, each message, each way to search or to filter, each input that is wrong or matches nothing. A scenario may go through other screens to reach its own, such as the one that signs in; everything it expects is on that one screen. Be exhaustive: leave no behaviour of a screen of the brief without its scenario.",
  business:
    "At this level, plan one scenario for each whole journey of the brief inside one application, through its screens to its result. Be exhaustive: each journey the brief makes possible, and each way it may end, has its scenario.",
  "cross-application":
    "At this level, plan the scenarios that do an action of the brief in one application and check its effect in another. Be exhaustive: each effect of the brief that crosses applications has its scenario.",
  "end-to-end": "At this level, plan the scenarios that follow a journey of the brief through three applications or more.",
};

/** What a plan of visual tests alone makes of a brief. */
const VISUAL_READING =
  "This plan is of visual tests alone, and the other tests of the brief are written already: each scenario has the kind visual and the level functional. A visual test leads to one state of a screen and compares it with a reference image; the harness adds that comparison after the last step, you do not. Plan one scenario for each state of the screens of the brief worth comparing: a screen as it opens, a dialog open, a form with its messages after a wrong input, a menu unfolded, a tab chosen, the page a click on a row leads to. Cite the actions that lead to the state, and expect one text that tells it is reached. A visual test verifies the layout and the look, not the data: plan none to verify a value. Be exhaustive: every screen the brief goes through, and every state of each worth comparing, has its scenario.";

/**
 * Writes the request that starts the session that plans: the brief, the domains of the knowledge with what
 * the sources hold of each, the applications and how to sign in to them, then the next call. Nothing else of
 * the knowledge is given: the agent explores it by levels.
 *
 * @remarks
 * The rules of a plan are not repeated: each is a gate of the harness, told when it refuses, or a line of
 * the system instructions. What only the agent that writes a test needs, such as the packages a test may
 * import, is left to it.
 *
 * @param brief - What the developer wants tested, in their own words, if anything.
 * @param environment - The environment the tests run against.
 * @param domains - The domains of the knowledge, a line each, as `IndexMap.domains` gives them.
 * @param applications - The applications a test may be about.
 * @param visual - Whether the plan is of visual tests alone; `false` by default.
 * @returns The message to send to the agent that plans.
 */
export function planRequest(
  brief: string | undefined,
  environment: string,
  domains: readonly string[],
  applications: readonly Application[],
  levels: readonly ScenarioLevel[],
  visual = false,
): string {
  const asked =
    brief === undefined
      ? "No brief was given: plan the tests that matter most across the domains below."
      : `Brief of the developer, in their words:\n<brief>\n${brief}\n</brief>`;
  const next =
    brief === undefined
      ? `Next: call ${DOMAIN_TOOL} on the domains above that matter most, read what they hold, do it once on the screens, then call ${PLAN_TOOL}.`
      : `Next: call ${DOMAIN_TOOL} on the domain the brief is about, read what it needs, do the brief once on the screens, then call ${PLAN_TOOL}.`;
  const known = applications.map((application) => `- ${application.id} (${application.name}, ${application.type}): ${signIn(application, environment)}`);
  return [
    `Plan Playwright tests for the environment ${environment}.`,
    asked,
    `Knowledge of the applications, by domain:\n${domains.join("\n")}`,
    `Applications:\n${known.join("\n")}`,
    `Levels of the pyramid of tests asked: ${levels.join(", ")}.`,
    ...(visual
      ? [VISUAL_READING]
      : levels.length === 1
        ? [
            `This plan is of the level ${levels[0]!} alone, and the tests of the levels below it are written already. ${LEVEL_READINGS[levels[0]!]} Never say in uncovered that this level cannot do the whole brief: plan what it verifies of it.`,
          ]
        : []),
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
