import type { IdentifiedTest, TestStorePort } from "@open-qa-stack/domain";

/** The tests kept under their identifiers in memory, which records what it was told, call by call. */
export class MemoryTestStore implements TestStorePort {
  /** The tests each call told, in order. */
  readonly told: (readonly IdentifiedTest[])[] = [];

  async identify(tests: readonly IdentifiedTest[]): Promise<void> {
    this.told.push(tests);
  }
}
