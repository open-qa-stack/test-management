/** Raised when the command cannot do what it is asked as it is asked: the message says what to change. */
export class UsageError extends Error {
  /** @param message - What is wrong, and what to change. */
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}
