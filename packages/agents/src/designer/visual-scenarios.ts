import type { PlannedScenario } from "@open-qa-stack/domain";
import type { CoveringTest } from "./plan-draft.ts";

/**
 * The visual scenarios an agent planned, each ending with the comparison of the state it leads to with its
 * reference.
 *
 * @remarks
 * The agent says which states are worth comparing and how a test reaches each: a screen as it opens, a
 * dialog open, a form with its messages. The harness adds the comparison after the last step: of the whole
 * page, at the tolerance of the configuration. It masks nothing by itself: what changes from one run to the
 * next is for the agent that writes the test to find, once the harness ran the test again and told it the
 * screen differed.
 *
 * @param scenarios - The scenarios of the plan.
 * @param tolerance - The share of the pixels of a screen that may differ from its reference, from 0 to 1.
 * @returns The scenarios, the last step of each visual one ending with its comparison.
 */
export function withComparisons<Scenario extends PlannedScenario>(scenarios: readonly Scenario[], tolerance: number): Scenario[] {
  return scenarios.map((scenario) => {
    const last = scenario.steps.at(-1);
    if (scenario.kind !== "visual" || last === undefined || last.screenshot !== undefined) return scenario;
    return { ...scenario, steps: [...scenario.steps.slice(0, -1), { ...last, screenshot: { tolerance } }] };
  });
}

/**
 * The screens the tests of a repository open by an address that none of its visual tests compares, which the
 * agent that plans visual tests is told of: it says what to make of each.
 *
 * @param existing - The tests the repository already has.
 * @returns Each screen, by its application then its route, such as `shop /orders`, in the order the tests open them.
 */
export function uncomparedScreens(existing: readonly Pick<CoveringTest, "visual" | "opens">[]): string[] {
  const named = (tests: typeof existing) => [
    ...new Set(tests.flatMap((test) => test.opens).flatMap((line) => (line.screen === undefined ? [] : [`${line.application} ${line.screen}`]))),
  ];
  const compared = named(existing.filter((test) => test.visual));
  return named(existing.filter((test) => !test.visual)).filter((screen) => !compared.includes(screen));
}
