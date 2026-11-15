/** What a scenario of a test plan checks. */
export type ScenarioKind = "functional" | "visual" | "accessibility" | "other";

/**
 * Where a scenario stands in the pyramid of tests, from its base to its top: `smoke`, the application answers;
 * `functional`, one screen does and shows what it must, one behaviour a test; `business`, a whole journey
 * through several screens ends as it must; `cross-application`, an action in an application has its effect
 * in another; `end-to-end`, a journey goes through the whole information system.
 */
export type ScenarioLevel = "smoke" | "functional" | "business" | "cross-application" | "end-to-end";

/** Whether a test only reads the data of the environment, or creates, changes or removes some. */
export type ScenarioEffect = "read" | "write";

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

/** The element a screen showed an expected text in, as the harness read it from the exploration of the agent. */
export interface ExpectedElement {
  /** The text, one of those its expect names. */
  readonly text: string;
  /** The locator a test finds the element with. */
  readonly locator: string;
  /** Whether it is a field, which holds the text as its value. */
  readonly field: boolean;
  /** How many elements the locator designated while the screen showed the text, when they were several and any of them will do: its assertion counts them. */
  readonly count?: number;
}

/** A result a step expects to see after its action. */
export interface PlannedExpect {
  /** The result, in one sentence. */
  readonly result: string;
  /** The exact texts the screen then displays. */
  readonly shows: readonly string[];
  /** The exact texts the screen no longer displays. */
  readonly absent: readonly string[];
  /** The element of each text the exploration showed in one; a text without one is found anywhere on the page. The harness writes them, never the agent. */
  readonly elements: readonly ExpectedElement[];
}

/** A line of code of a step, as the exploration gave it: what a page object is written from. */
export interface PlannedLine {
  /** Identifier of the application it was done on. */
  readonly application: string;
  /** The screen it acts on, by its route, when the exploration told where the page was. */
  readonly screen?: string;
  /** The line of code that does it on `page`, as the browser tool returned it. */
  readonly code: string;
  /** The value it typed or chose, when it was given as a text. */
  readonly typed?: string;
}

/** The comparison of a whole screen with its reference a step ends with, as the harness wrote it for a visual scenario. */
export interface PlannedScreenshot {
  /** The share of the pixels that may differ, from 0 to 1. */
  readonly tolerance: number;
}

/** A step of a scenario: one action of the user and what it should produce. Its test writes it as one `test.step`. */
export interface PlannedStep {
  /** What the user does, in one sentence. */
  readonly action: string;
  /** Identifier of the application the step ends on and its expects are asserted on, when it is not that of the test: the test acts on it in a tab of its own. The harness writes it, never the agent. */
  readonly application?: string;
  /** The lines of code that do it in a test, as the browser tools returned them during the exploration; none for a step done on no screen. The harness writes them, never the agent. */
  readonly code: readonly string[];
  /**
   * Whether the step puts back what the scenario changed. Its test runs it, and every step after it, even when an
   * earlier step failed, so that a test that fails leaves the data of the environment as it found it.
   */
  readonly restores?: boolean;
  /** The comparison of the screen with its reference the step ends with, for a visual scenario. The harness writes it, never the agent. */
  readonly screenshot?: PlannedScreenshot;
  /** Where each line of code comes from, one for each line, in their order. The harness writes them, never the agent. */
  readonly lines?: readonly PlannedLine[];
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
  /** Its level in the pyramid of tests. */
  readonly level: ScenarioLevel;
  readonly case: ScenarioCase;
  /** Whether its test only reads the data of the environment or writes some: a test that writes creates its own data or puts back what it changed, so that it passes again. */
  readonly effect: ScenarioEffect;
  /** Identifier of the application the test is of: its file is in the folder of that application, whose base address is its own. */
  readonly application: string;
  /** Identifiers of the other applications the test acts on, for a test of several; the harness writes them, never the agent. */
  readonly applications?: readonly string[];
  /** Identifier of the domain of the index the scenario comes from. */
  readonly domain: string;
  /** A slug of the functionality of that domain the scenario verifies, such as `customer-search`: the tests of one functionality share a folder. */
  readonly feature: string;
  /** The sources the scenario relies on. */
  readonly sources: readonly ScenarioSource[];
  /** The values the test enters. */
  readonly data: readonly ScenarioValue[];
  /** The steps, in the order the user does them. */
  readonly steps: readonly PlannedStep[];
}

/** Something the brief asks that the application does not let a test do, as the agent that plans found it. */
export interface UncoveredRequest {
  /** What the brief asks, in one sentence. */
  readonly asked: string;
  /** Why no test of the plan does it: what the agent saw of the application or read of its sources. */
  readonly reason: string;
}

/** Who set a scenario or a test aside as a duplicate: the harness, with the check that decided, or the agent that reviews the plan, in a session of its own. */
export type DuplicateOrigin = { readonly by: "harness"; readonly check: string } | { readonly by: "agent"; readonly role: "plan-reviewer" };

/** A scenario an agent submitted and the harness set aside from the plan: another scenario already verifies what it does. It is kept, not lost. */
export interface SetAsideScenario {
  /** The slug the agent gave it. */
  readonly id: string;
  readonly title: string;
  /** What it was meant to verify. */
  readonly intent: string;
  /** What already verifies it: the identifier of a scenario of the plan, or the path of a test the repository already has. */
  readonly duplicates: string;
  readonly origin: DuplicateOrigin;
  /** Why it is a duplicate, in a sentence. */
  readonly reason: string;
  /** When it was set aside, ISO 8601 in UTC. */
  readonly at: string;
}

/**
 * Why the harness stopped asking the agent for scenarios: `covered` when the agent said the brief is covered,
 * `exhausted` when the scenarios it last submitted were duplicates, time after time, `refused` when the harness refused its last calls, time after time, while the plan held scenarios,
 * `session-end` when the session of the agent ended without another scenario, `none` when the agent submitted
 * no scenario at all and said why no test can do what the brief asks.
 */
export type PlanEnd = "covered" | "exhausted" | "refused" | "session-end" | "none";

/** The tests an agent means to write, before it writes any. */
export interface TestPlan {
  readonly scenarios: readonly PlannedScenario[];
  /** Why the plan holds no more scenarios; left out for a plan nothing was asked after. */
  readonly ended?: PlanEnd;
  /** The scenarios set aside as duplicates, in the order they were submitted; left out when there is none. */
  readonly setAside?: readonly SetAsideScenario[];
  /** What the brief asks and no scenario covers, because the application does not allow it; left out when the plan covers the brief. */
  readonly uncovered?: readonly UncoveredRequest[];
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
