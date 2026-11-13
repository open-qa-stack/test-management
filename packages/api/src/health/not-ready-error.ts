/** Raised when the instance is not ready; the readiness route answers `503` with its body. */
export class NotReadyError extends Error {
  /** The body of the answer. */
  readonly readiness: import("./readiness.ts").Readiness;

  constructor(readiness: import("./readiness.ts").Readiness) {
    super("The instance is not ready.");
    this.name = "NotReadyError";
    this.readiness = readiness;
  }
}
