import type { PlannedScenario } from "@open-qa-stack/domain";

/** What a scenario says of itself and expects, whether an agent submitted it or a plan kept it. */
export type DescribedScenario = Pick<PlannedScenario, "title" | "case" | "application" | "intent" | "data"> & {
  readonly steps: readonly {
    readonly action: string;
    readonly expects: readonly { readonly result: string; readonly shows: readonly string[]; readonly absent: readonly string[] }[];
  }[];
};

/** What a scenario does and verifies, as the judge of duplicates reads it. */
export function described(scenario: DescribedScenario): string {
  const texts = (label: string, list: readonly string[]) => (list.length === 0 ? [] : [`${label} ${list.map((text) => JSON.stringify(text)).join(", ")}`]);
  return [
    `${scenario.title} (${scenario.case}, ${scenario.application}). ${scenario.intent}`,
    ...(scenario.data.length === 0 ? [] : [`Enters: ${scenario.data.map((entry) => JSON.stringify(entry.value)).join(", ")}`]),
    ...scenario.steps.map((step, at) => {
      const expected = step.expects.flatMap((expect) => [expect.result, ...texts("shows", expect.shows), ...texts("no longer shows", expect.absent)]);
      return `${at + 1}. ${step.action}${expected.length === 0 ? "" : ` -> ${expected.join("; ")}`}`;
    }),
  ].join("\n");
}
