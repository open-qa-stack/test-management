import type { TestDecision } from "./test-review.ts";

/** What keeps the decisions a person made of the tests the agents wrote. */
export interface TestDecisionStorePort {
  /** @returns Every decision, one by test. */
  list(): Promise<TestDecision[]>;

  /** Keeps a decision, in place of the one before for the same test. */
  set(decision: TestDecision): Promise<void>;
}
