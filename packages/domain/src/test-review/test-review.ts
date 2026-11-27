import type { ScenarioKind, ScenarioLevel } from "../test/test-plan.ts";
import type { Verdict } from "../test/verdict.ts";

/**
 * Where a test the agents wrote stands in the review of a person: `in_review` until the person decides, `in_correction`
 * while the session that wrote it corrects it as the person asked, `validated` once it entered the working branch of the
 * test repository, `set_aside` when the person left it out.
 */
export type ReviewStatus = "in_review" | "in_correction" | "validated" | "set_aside";

/** Why a person sets a test aside: another test already verifies it, it is out of the scope, it checks the wrong thing, or it is not at the right level. */
export const SET_ASIDE_REASONS = ["covered", "out_of_scope", "wrong_oracle", "wrong_level"] as const;

/** Why a person set a test aside. */
export type SetAsideReason = (typeof SET_ASIDE_REASONS)[number];

/** What a person decided of a test the agents wrote, under the identifier of its tag `@oqas-id-…`. */
export type TestDecision =
  | { readonly id: string; readonly status: "validated"; readonly at: string }
  | {
      readonly id: string;
      readonly status: "set_aside";
      readonly at: string;
      readonly reason: SetAsideReason;
      /** For `covered`, the path of the test that already verifies it. */
      readonly coveredBy?: string;
      /** What the person added, in their words. */
      readonly note?: string;
    }
  | {
      readonly id: string;
      readonly status: "in_correction";
      readonly at: string;
      /** What the person asked the agents to change, in their words. */
      readonly instruction: string;
      /** The session that corrects it: the one that wrote it, resumed with the instruction. */
      readonly session: string;
    };

/** A test the agents wrote, as the queue of the review lists it. */
export interface ReviewedTest {
  /** Its identifier, the UUID of its tag `@oqas-id-…`. */
  readonly id: string;
  /** The path of its file, relative to the root of the test repository. */
  readonly path: string;
  /** The title of its scenario. */
  readonly title: string;
  readonly application: string;
  readonly domain: string;
  /** The functionality of the domain it verifies. */
  readonly feature: string;
  readonly level: ScenarioLevel;
  readonly kind: ScenarioKind;
  /** The branch of the design that wrote it. */
  readonly branch: string;
  /** When its design ran, as an ISO 8601 date. */
  readonly designedAt: string;
  /** The verdict of its last run while it was written. */
  readonly verdict: Verdict;
  /** How many times it ran while it was written. */
  readonly runs: number;
  /** Whether an agent reviewed it against its scenario. */
  readonly reviewed: boolean;
  /** How many remarks the agents that reviewed it made, on its coherence and on its code. */
  readonly remarkCount: number;
  readonly status: ReviewStatus;
}

/** A remark of an agent that reviewed a test: on its coherence with its scenario, or on its code. */
export interface ReviewRemark {
  readonly about: "coherence" | "code";
  /** Where it is, such as `step 2` or a line. */
  readonly where: string;
  /** What is wrong, in a sentence. */
  readonly what: string;
  /** The rule of the charter it breaks, when it breaks one. */
  readonly rule?: string;
}

/** A file a design wrote for a test: the test itself, or what it relies on, such as a page object. */
export interface ProposedFile {
  /** Its path, relative to the root of the test repository. */
  readonly path: string;
  /** Its text, as the design branch has it. */
  readonly content: string;
  /** How many lines the design added to it. */
  readonly added: number;
}

/** A test the agents wrote, with what a person reads to decide of it. */
export interface TestProposal extends ReviewedTest {
  /** What the person asked of the design, in their words, when they asked something. */
  readonly brief?: string;
  /** What the scenario verifies, and why. */
  readonly intent: string;
  /** The sources the scenario relies on, each with the element it names, when it names one. */
  readonly sources: readonly { readonly source: string; readonly item?: string }[];
  /** Its steps, each with what it expects. */
  readonly steps: readonly { readonly action: string; readonly expects: readonly string[] }[];
  /** Why it stands as it does, as the harness or the agent that wrote it said. */
  readonly reason: string;
  readonly remarks: readonly ReviewRemark[];
  /** Its file first, then those it relies on. */
  readonly files: readonly ProposedFile[];
  /** What the person decided, once they did. */
  readonly decision?: TestDecision;
}

/** The queue of the review: the tests to review, those set aside, and how many of each; those in correction count among those to review. */
export interface ReviewQueue {
  readonly tests: readonly ReviewedTest[];
  readonly counts: { readonly inReview: number; readonly setAside: number };
}
