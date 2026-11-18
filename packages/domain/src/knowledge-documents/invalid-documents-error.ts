import type { ConfigError } from "../config/types.ts";

/** Raised when documents uploaded to a source are refused: nothing of the upload is kept. */
export class InvalidDocumentsError extends Error {
  /** Every error found, each at the document it is about, `/documents/<rank>` in the order of the upload. */
  readonly errors: readonly ConfigError[];

  /** @param errors - Every error found. */
  constructor(errors: readonly ConfigError[]) {
    super(`The documents are refused, and none is kept: ${errors.length === 1 ? "1 error was" : `${errors.length} errors were`} found.`);
    this.name = "InvalidDocumentsError";
    this.errors = errors;
  }
}
