/** A change to a test that cannot be written: a text that is not valid, a title another test of the file has, a step it does not have. */
export class TestChangeRefusedError extends Error {
  /** @param reason - Why, in a sentence written for the person. */
  constructor(reason: string) {
    super(reason);
    this.name = "TestChangeRefusedError";
  }
}
