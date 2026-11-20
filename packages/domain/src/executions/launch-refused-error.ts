/**
 * A launch of tests that cannot start: a session or another launch runs the tests of the repository already, or
 * the environment asked for is not one the configuration declares. Its message says what to do.
 */
export class LaunchRefusedError extends Error {
  /** @param message - Why, and what to do. */
  constructor(message: string) {
    super(message);
    this.name = "LaunchRefusedError";
  }
}
