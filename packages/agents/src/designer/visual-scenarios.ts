import type { PlannedScenario } from "@open-qa-stack/domain";
import type { Journal } from "../common/journal.ts";
import { writtenValues } from "./assertion-line.ts";
import { screenFile } from "./page-object-file.ts";
import type { CoveringTest } from "./plan-draft.ts";
import type { ScreenWatch } from "./screen-watch.ts";

/** The functionality the visual scenarios of a domain are filed under. */
export const VISUAL_FEATURE = "visual";

/** What the visual scenarios of a plan are made from. */
export interface VisualRules {
  /** The applications that have a user interface, by their identifier, with their name. */
  readonly applications: readonly { readonly id: string; readonly name: string }[];
  /** The screens as the harness opens them again by itself, in a browser of its own. */
  readonly screens: Pick<ScreenWatch, "changingRoles">;
  /** What the agent that planned saw of the screens, for a state the harness cannot open again. */
  readonly seen: Pick<ScreenWatch, "holdingRoles">;
  /** The share of the pixels of a screen that may differ from its reference, from 0 to 1. */
  readonly tolerance: number;
  /** The paths of the tests the repository already has: a screen one of them compares is not compared again. */
  readonly present: readonly string[];
  /** The tests the repository already has: the values each writes, which a screen may show changed, and the screens each opens. */
  readonly existing: readonly Pick<CoveringTest, "verified" | "writes" | "domain" | "opens">[];
}

/** The lines of code of a scenario, with where each comes from. */
const linesOf = (scenario: PlannedScenario) => scenario.steps.flatMap((step) => step.lines ?? []);

/** What the tests write in the environment of an application, which a screen may show changed while another runs: those of a plan, and those already there. */
function writtenBy(scenarios: readonly PlannedScenario[], rules: Pick<VisualRules, "existing">): (application: string) => string[] {
  return (application) => [
    ...scenarios.filter((scenario) => scenario.application === application).flatMap(writtenValues),
    ...rules.existing.filter((earlier) => earlier.verified.application === application).flatMap((earlier) => earlier.writes),
  ];
}

/**
 * The visual scenarios an agent planned, each ending with the comparison of the state it leads to with its
 * reference.
 *
 * @remarks
 * The agent says which states are worth comparing and how a test reaches each: a screen as it opens, a
 * dialog open, a form with its messages. The harness adds the comparison after the last step, at the
 * tolerance of the configuration, and masks what changes: for a screen an address opens, what it sees change
 * between two looks; for a state reached by actions, which it cannot open again by itself, the elements the
 * screens showed a value a test writes in.
 *
 * @param scenarios - The scenarios of the plan.
 * @param rules - The applications, the screens, the tolerance and the tests already there.
 * @returns The scenarios, the last step of each visual one ending with its comparison.
 */
export async function withComparisons<Scenario extends PlannedScenario>(scenarios: readonly Scenario[], rules: VisualRules): Promise<Scenario[]> {
  const written = writtenBy(scenarios, rules);
  const compared: Scenario[] = [];
  for (const scenario of scenarios) {
    const last = scenario.steps.at(-1);
    if (scenario.kind !== "visual" || last === undefined || last.screenshot !== undefined) {
      compared.push(scenario);
      continue;
    }
    const lines = linesOf(scenario);
    const application = last.application ?? scenario.application;
    const address = lines.length === 1 ? OPENED.exec(lines[0]!.code)?.[1] : undefined;
    const looked = address === undefined ? undefined : await rules.screens.changingRoles(application, JSON.parse(address) as string, written(application));
    const roles = looked?.roles ?? rules.seen.holdingRoles(application, written(application));
    const screenshot = { mask: roles.map((role) => `page.getByRole(${JSON.stringify(role)})`), tolerance: rules.tolerance };
    compared.push({ ...scenario, steps: [...scenario.steps.slice(0, -1), { ...last, screenshot }] });
  }
  return compared;
}

/** A line of code that opens an address of the application of its test. */
const OPENED = /^await page\.goto\(("(?:[^"\\]|\\.)*")\);$/;

/**
 * The visual scenarios of a plan: one for each screen its scenarios open by an address, which compares the
 * screen with its reference.
 *
 * @remarks
 * The harness writes them, after the plan is accepted: which screens a plan goes through is no matter of
 * judgment. A screen reached only by a click has no address of its own a test could open, and is left out.
 * The zones whose content changes are masked by their role: those the harness saw change between two looks
 * at the screen, and those that show a value a test of the plan writes. The agent that writes the test may
 * mask more, from what it sees fail.
 *
 * @param scenarios - The scenarios of the plan.
 * @param rules - The applications, the screens, the tolerance and the tests already there.
 * @param journal - Where each screen left out is written.
 * @returns The visual scenarios, in the order the plan opens their screens.
 */
export async function visualScenarios(scenarios: readonly PlannedScenario[], rules: VisualRules, journal: Journal): Promise<PlannedScenario[]> {
  const visual: PlannedScenario[] = [];
  const written = writtenBy(scenarios, rules);
  // A screen a visual scenario of the plan already compares as it opens is not compared again.
  const compared = scenarios
    .filter((scenario) => scenario.kind === "visual")
    .map(linesOf)
    .flatMap((lines) => (lines.length === 1 ? lines : []));
  // The screens the plan opens, then those the tests already there open: each has its comparison.
  const opening = [
    ...scenarios.map((scenario) => ({ domain: scenario.domain, lines: linesOf(scenario) })),
    ...rules.existing.map((earlier) => ({ domain: earlier.domain, lines: earlier.opens })),
  ];
  for (const scenario of opening) {
    for (const line of scenario.lines) {
      if (compared.some((other) => other.application === line.application && other.screen === line.screen)) continue;
      const address = OPENED.exec(line.code)?.[1];
      const application = rules.applications.find((candidate) => candidate.id === line.application);
      if (address === undefined || line.screen === undefined || application === undefined) continue;
      const id = `visual-${application.id}-${screenFile(line.screen).file.replace(/\.page\.ts$/, "")}`;
      if (visual.some((other) => other.id === id) || rules.present.some((path) => path.endsWith(`/${id}.spec.ts`))) continue;
      const changing = await rules.screens.changingRoles(application.id, JSON.parse(address) as string, written(application.id));
      if (changing === undefined) {
        journal.record("info", `No visual scenario for the screen ${line.screen} of ${application.id}: the harness could not open it again.`);
        continue;
      }
      if (changing.left.length > 0)
        journal.record("info", `The screen ${line.screen} of ${application.id} changes in elements a comparison does not mask: ${changing.left.join(", ")}.`);
      visual.push({
        id,
        title: `The screen ${line.screen} of ${application.name} looks as its reference`,
        intent: `Verifies that the screen ${line.screen} keeps its layout and its look, what changes from one run to the next left out.`,
        kind: "visual",
        level: "functional",
        case: "nominal",
        effect: "read",
        application: application.id,
        domain: scenario.domain,
        feature: VISUAL_FEATURE,
        sources: [{ source: application.id }],
        data: [],
        steps: [
          {
            action: `Open ${JSON.parse(address) as string} and compare the screen with its reference`,
            code: [`await page.goto(${address});`],
            lines: [{ application: application.id, screen: line.screen, code: `await page.goto(${address});` }],
            screenshot: { mask: changing.roles.map((role) => `page.getByRole(${JSON.stringify(role)})`), tolerance: rules.tolerance },
            expects: [],
          },
        ],
      });
    }
  }
  return visual;
}
