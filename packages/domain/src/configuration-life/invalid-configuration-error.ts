import type { ConfigError } from "../config/types.ts";

/** Raised when a configuration that would become a revision is not valid by the schema of the configuration file. */
export class InvalidConfigurationError extends Error {
  /** Every error found, each where it is. */
  readonly errors: readonly ConfigError[];
  /** The number of the revision in force, which stays so; `undefined` when the instance has none. */
  readonly inForce: number | undefined;

  /**
   * @param what - What was refused, such as the name of the configuration file.
   * @param errors - Every error found.
   * @param inForce - The number of the revision in force, which stays so; `undefined` when the instance has none.
   */
  constructor(what: string, errors: readonly ConfigError[], inForce?: number) {
    super(`${what} is not a valid configuration: ${errors.length === 1 ? "1 error was" : `${errors.length} errors were`} found.`);
    this.name = "InvalidConfigurationError";
    this.errors = errors;
    this.inForce = inForce;
  }
}
