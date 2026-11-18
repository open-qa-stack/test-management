/** Raised by the runtime of the agents of a run its host asked to stop: no session opens, and no turn goes on. */
export class RunStoppedError extends Error {
  public constructor() {
    super("The run was asked to stop.");
    this.name = "RunStoppedError";
  }
}
