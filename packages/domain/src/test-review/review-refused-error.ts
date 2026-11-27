/** A decision of the review the test repository or the instance cannot take now, with what to do instead. */
export class ReviewRefusedError extends Error {
  /** @param message - Why, and what to do. */
  constructor(message: string) {
    super(message);
    this.name = "ReviewRefusedError";
  }
}
