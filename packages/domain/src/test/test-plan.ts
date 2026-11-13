/** What a scenario of a test plan checks. */
export type ScenarioKind = "functional" | "visual" | "accessibility" | "other";

/** A source a scenario relies on: a source of the domain index, and an element of it when one is named. */
export interface ScenarioSource {
  /** Identifier of the source in the domain index. */
  readonly source: string;
  /** The element of the source, such as a section of a document or a table of a base. */
  readonly item?: string;
}

/** Whether a scenario follows the expected path, or what the application answers to an input that matches nothing, is wrong or is forbidden. */
export type ScenarioCase = "nominal" | "negative";

/** A value a test enters, with what showed it. */
export interface ScenarioValue {
  /** The value, as the tool that showed it gave it. */
  readonly value: string;
  /** The identifier of the source or the application whose tool showed it, or `made-up` for a value the test invents. */
  readonly from: string;
}

/** A result a step expects to see after its action. */
export interface PlannedExpect {
  /** The result, in one sentence. */
  readonly result: string;
  /** The exact texts the screen then displays. */
  readonly shows: readonly string[];
  /** The exact texts the screen no longer displays. */
  readonly absent: readonly string[];
}

/** A step of a scenario: one action of the user and what it should produce. Its test writes it as one `test.step`. */
export interface PlannedStep {
  /** What the user does, in one sentence. */
  readonly action: string;
  /** What the step expects after the action; none for a step that only leads to the next. */
  readonly expects: readonly PlannedExpect[];
}

/** A scenario of a test plan: one test to write. */
export interface PlannedScenario {
  /** A slug, unique in the plan, that names the file of its test. */
  readonly id: string;
  readonly title: string;
  /** What the scenario is meant to verify, and why. */
  readonly intent: string;
  readonly kind: ScenarioKind;
  readonly case: ScenarioCase;
  /** Identifier of the one application the test is about. */
  readonly application: string;
  /** Identifier of the domain of the index the scenario comes from. */
  readonly domain: string;
  /** The sources the scenario relies on. */
  readonly sources: readonly ScenarioSource[];
  /** The values the test enters. */
  readonly data: readonly ScenarioValue[];
  /** The steps, in the order the user does them. */
  readonly steps: readonly PlannedStep[];
}

/** The tests an agent means to write, before it writes any. */
export interface TestPlan {
  readonly scenarios: readonly PlannedScenario[];
}

/** Whether a plan may be carried out. */
export type PlanDecision = { readonly accepted: true } | { readonly accepted: false; readonly reason: string };

/**
 * Decides whether a test plan may be carried out: accepted as it is when the agent works on its own, or
 * given to a person for their go-ahead.
 */
export interface PlanReview {
  /**
   * Reviews a plan.
   *
   * @param plan - The plan the agent submits.
   * @returns Whether it is accepted, and why not when it is refused.
   */
  review(plan: TestPlan): Promise<PlanDecision>;
}
