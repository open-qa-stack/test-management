import type { PlannedScenario } from "@open-qa-stack/domain";

/** The option of a test that holds its tags, as the harness writes it after the title. */
const TAGS = /(\btest\s*\(\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)\s*,\s*)(?:\{\s*tag:\s*\[[^\]]*\]\s*,?\s*\}\s*,\s*)?/;

/** What of a scenario its tags are made of. */
export type TaggedScenario = Pick<PlannedScenario, "level" | "domain" | "feature" | "application" | "applications" | "kind" | "case" | "effect">;

/**
 * The tags of the test of a scenario, by which a run selects tests: its level in the pyramid of tests, its
 * domain, each application it acts on, what it checks, whether it follows the expected path, and whether it only reads the data of the environment or writes some.
 *
 * @param scenario - The scenario.
 * @returns The tags, each with its `@`, such as `@level-functional` and `@domain-customers`.
 */
export function scenarioTags(scenario: TaggedScenario): string[] {
  const applications = [scenario.application, ...(scenario.applications ?? [])].map((application) => `@app-${application}`);
  return [
    `@level-${scenario.level}`,
    `@domain-${scenario.domain}`,
    `@feature-${scenario.feature}`,
    ...applications,
    `@kind-${scenario.kind}`,
    `@case-${scenario.case}`,
    `@data-${scenario.effect}`,
  ];
}

/**
 * The text of a test with the tags of its scenario: the harness writes them, never the agent, so that a test
 * the agent rewrote keeps those of its plan.
 *
 * @param content - The text of a test file.
 * @param scenario - The scenario the test is of.
 * @returns The text, the first test of which bears the tags of the scenario in place of any it had.
 */
export function withTags(content: string, scenario: TaggedScenario): string {
  return content.replace(TAGS, (_whole, opening: string) => `${opening}{ tag: ${JSON.stringify(scenarioTags(scenario))} }, `);
}

/**
 * What a scenario does to the data of the environment, in words, as its sheet and the file of its plan say it.
 *
 * @param effect - The effect of the scenario.
 * @returns `reads data` or `writes data`.
 */
export function effectWords(effect: PlannedScenario["effect"]): string {
  return effect === "write" ? "writes data" : "reads data";
}
