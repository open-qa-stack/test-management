/** A value that cannot be saved: an empty one, or one the environment of the process sets. Its message says which, and what to do. */
export class SecretRefusedError extends Error {
  /** @param message - Why, and what to do. */
  constructor(message: string) {
    super(message);
    this.name = "SecretRefusedError";
  }
}
