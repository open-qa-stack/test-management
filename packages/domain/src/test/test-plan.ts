/** What a scenario of a test plan checks. */
export type ScenarioKind = "functional" | "visual" | "accessibility" | "other";

/** A source a scenario relies on: a source of the domain index, and an element of it when one is named. */
export interface ScenarioSource {
  /** Identifier of the source in the domain index. */
  readonly source: string;
  /** The element of the source, such as a section of a document or a table of a base. */
  readonly item?: string;
}

/** A scenario of a test plan: one test to write. */
export interface PlannedScenario {
  /** A slug, unique in the plan, that the test written for it names. */
  readonly id: string;
  readonly title: string;
  /** What the scenario is meant to verify, and why. */
  readonly intent: string;
  readonly kind: ScenarioKind;
  /** What the test expects of the application. */
  readonly expected: string;
  /** The sources the scenario relies on. */
  readonly sources: readonly ScenarioSource[];
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
