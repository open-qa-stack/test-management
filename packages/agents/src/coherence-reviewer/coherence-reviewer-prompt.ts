import type { PlannedScenario } from "@open-qa-stack/domain";

/** Name of the tool the reviewer of a test reports its findings with. */
export const FINDINGS_TOOL = "report_findings";

/** System instructions of the agent that reviews a test against the scenario of its plan. */
export const COHERENCE_REVIEWER_INSTRUCTIONS = `You review one Playwright test, written by another agent, against the scenario of the plan it carries out. The test passed. You write no test and you judge nothing of its style.

A test is coherent with its scenario when a person who reads the scenario would agree the test verifies it:
- each step does what its action says, with the values of the data of the scenario;
- each result a step expects is asserted, on what the application answers, not on what the test itself typed;
- the intent of the scenario is verified by an assertion that would fail if the application did not do it.

Report only what breaks one of these: a step that does something else or nothing, a result no assertion verifies, an assertion that cannot fail, an intent the test never verifies. A locator, a wait, a name or a layout you would have written otherwise is no finding.
When in doubt, it is no finding: a finding costs the other agent a repair.

Call ${FINDINGS_TOOL} once: each finding with where it is — the step, by its number — and what is wrong, in one sentence; an empty list when the test is coherent with its scenario. Then answer with one word.`;

/**
 * Writes the request of a review: the scenario as its plan holds it, then the test.
 *
 * @param scenario - The scenario.
 * @param test - The text of its test.
 * @returns The message that starts the session of the review.
 */
export function coherenceRequest(scenario: PlannedScenario, test: string): string {
  const data = scenario.data.length === 0 ? "none" : scenario.data.map((entry) => JSON.stringify(entry.value)).join(", ");
  const steps = scenario.steps.map((step, at) => {
    const expects = step.expects.map((expect) => {
      const texts = [...expect.shows.map((text) => `shows ${JSON.stringify(text)}`), ...expect.absent.map((text) => `no longer shows ${JSON.stringify(text)}`)];
      return `   - ${expect.result}${texts.length === 0 ? "" : `: ${texts.join(", ")}`}`;
    });
    return [`${at + 1}. ${step.action}`, ...expects].join("\n");
  });
  return [
    `Scenario ${scenario.id} — ${scenario.title} (${scenario.level}, ${scenario.case}).`,
    `Intent: ${scenario.intent}`,
    `Data: ${data}.`,
    `Steps, each with what it expects:\n${steps.join("\n")}`,
    `The test:\n\`\`\`ts\n${test.trimEnd()}\n\`\`\``,
    `Next: call ${FINDINGS_TOOL} with what the test does not do or verify of its scenario, or with an empty list.`,
  ].join("\n\n");
}
