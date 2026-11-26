import type { TestDecision, TestDecisionStorePort } from "@open-qa-stack/domain";

/** What a person decided of the tests the agents wrote, kept in memory. */
export class MemoryTestDecisionStore implements TestDecisionStorePort {
  readonly #decisions = new Map<string, TestDecision>();

  list(): Promise<TestDecision[]> {
    return Promise.resolve([...this.#decisions.values()].toSorted((a, b) => a.id.localeCompare(b.id)));
  }

  set(decision: TestDecision): Promise<void> {
    this.#decisions.set(decision.id, decision);
    return Promise.resolve();
  }
}
