/** A trace asked for that the run read did not keep: no run ran the test, it kept no trace of it, or its file is gone. */
export class UnknownTraceError extends Error {
  /** @param path - The path of the test. */
  constructor(path: string) {
    super(`The run read of ${path} kept no trace of it that can be read.`);
    this.name = "UnknownTraceError";
  }
}
