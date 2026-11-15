import type { PlannedScenario } from "@open-qa-stack/domain";

/** The option of a test that holds its tags, as the harness writes it after the title. */
const TAGS = /(\btest\s*\(\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)\s*,\s*)(?:\{\s*tag:\s*\[[^\]]*\]\s*,?\s*\}\s*,\s*)?/;

/**
 * The tags of the test of a scenario, by which a run selects tests: its level in the pyramid of tests, its
 * domain, its application, what it checks and whether it follows the expected path.
 *
 * @param scenario - The scenario.
 * @returns The tags, each with its `@`, such as `@level-functional` and `@domain-customers`.
 */
export function scenarioTags(scenario: Pick<PlannedScenario, "level" | "domain" | "application" | "kind" | "case">): string[] {
  return [`@level-${scenario.level}`, `@domain-${scenario.domain}`, `@app-${scenario.application}`, `@kind-${scenario.kind}`, `@case-${scenario.case}`];
}

/**
 * The text of a test with the tags of its scenario: the harness writes them, never the agent, so that a test
 * the agent rewrote keeps those of its plan.
 *
 * @param content - The text of a test file.
 * @param scenario - The scenario the test is of.
 * @returns The text, the first test of which bears the tags of the scenario in place of any it had.
 */
export function withTags(content: string, scenario: Pick<PlannedScenario, "level" | "domain" | "application" | "kind" | "case">): string {
  return content.replace(TAGS, (_whole, opening: string) => `${opening}{ tag: ${JSON.stringify(scenarioTags(scenario))} }, `);
}
