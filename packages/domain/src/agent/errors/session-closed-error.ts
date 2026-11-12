import { AgentRuntimeError } from "./agent-runtime-error.ts";

/** The session was closed while the agent was still answering. */
export class SessionClosedError extends AgentRuntimeError {
  /** Name of the error class, kept when the error is serialised. */
  public override readonly name = "SessionClosedError";

  public constructor() {
    super("The session was closed before the agent finished answering.");
  }
}
