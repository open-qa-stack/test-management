/** Base of every error a runtime reports in an `error` event. */
export class AgentRuntimeError extends Error {
  /** Name of the error class, kept when the error is serialised. */
  public override readonly name: string = "AgentRuntimeError";
}
