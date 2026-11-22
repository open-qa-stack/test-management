import { testIdOf, testIdTag, TEST_ID_TAG, type PlannedScenario } from "@open-qa-stack/domain";

/** The option of a test that holds its tags, as the harness writes it after the title. */
const TAGS = /(\btest\s*\(\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)\s*,\s*)(?:\{\s*tag:\s*\[[^\]]*\]\s*(?:,\s*)?\}\s*,\s*)?/;

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
 * The text of a test with the tags of its scenario and its identifier: the harness writes them, never the agent, so
 * that a test the agent rewrote keeps those of its plan, and the identifier the instance keeps its history under.
 *
 * @param content - The text of a test file.
 * @param scenario - The scenario the test is of.
 * @param id - The identifier of the test, a UUID, written as its tag `@oqas-id-<id>`.
 * @returns The text, the first test of which bears the tags of the scenario and its identifier in place of any it had.
 */
export function withTags(content: string, scenario: TaggedScenario, id: string): string {
  return content.replace(TAGS, (_whole, opening: string) => `${opening}{ tag: ${JSON.stringify([...scenarioTags(scenario), testIdTag(id)])} }, `);
}

/**
 * The identifier the text of a test bears, as the harness wrote it: that of a test a scenario repairs, which keeps it.
 *
 * @param content - The text of a test file.
 * @returns The UUID of its first tag `@oqas-id-…`; `undefined` when it bears none.
 */
export function borneId(content: string): string | undefined {
  return testIdOf([...content.matchAll(new RegExp(`${TEST_ID_TAG}[0-9a-f-]+`, "g"))].map(([tag]) => tag));
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
