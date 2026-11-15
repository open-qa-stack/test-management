import type { PlannedScenario } from "@open-qa-stack/domain";
import type { Journal } from "../common/journal.ts";
import { writtenValues } from "./assertion-line.ts";
import { screenFile } from "./page-object-file.ts";
import type { ScreenWatch } from "./screen-watch.ts";

/** The functionality the visual scenarios of a domain are filed under. */
export const VISUAL_FEATURE = "visual";

/** What the visual scenarios of a plan are made from. */
export interface VisualRules {
  /** The applications that have a user interface, by their identifier, with their name. */
  readonly applications: readonly { readonly id: string; readonly name: string }[];
  /** What the agent saw of the screens: the harness opens each screen again through it. */
  readonly screens: Pick<ScreenWatch, "changingRoles">;
  /** The share of the pixels of a screen that may differ from its reference, from 0 to 1. */
  readonly tolerance: number;
  /** The paths of the tests the repository already has: a screen one of them compares is not compared again. */
  readonly present: readonly string[];
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
  const written = (application: string) => scenarios.filter((scenario) => scenario.application === application).flatMap(writtenValues);
  for (const scenario of scenarios) {
    for (const line of scenario.steps.flatMap((step) => step.lines ?? [])) {
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
