import type { PlannedScenario } from "@open-qa-stack/domain";
import type { CoherenceFinding } from "./design-state.ts";

/**
 * Tells whether a test does and verifies what the scenario of its plan says.
 *
 * @remarks
 * The harness checks by itself what a rule can measure: the steps, their titles, the texts expected, the
 * locators. What is left is a matter of meaning, asked of a model outside the session of the agent that
 * wrote the test. The harness tells its findings to that agent once, keeps them with the test, and goes on
 * without it when it fails: it never refuses a test alone.
 */
export interface CoherenceJudge {
  /**
   * Reviews the test of a scenario.
   *
   * @param scenario - The scenario, as the plan holds it.
   * @param test - The text of its test, which passed.
   * @returns What the test does not do or verify of its scenario; none when it is coherent with it.
   * @throws Error when the judge could not answer.
   */
  judge(scenario: PlannedScenario, test: string): Promise<readonly CoherenceFinding[]>;
}
