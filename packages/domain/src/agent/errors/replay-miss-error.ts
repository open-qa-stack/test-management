import { AgentRuntimeError } from "./agent-runtime-error.ts";

/** A replayed session sent a request the recording does not contain. */
export class ReplayMissError extends AgentRuntimeError {
  /** Name of the error class, kept when the error is serialised. */
  public override readonly name = "ReplayMissError";
  /** Description of the missing request. */
  public readonly request: string;

  /** @param request - Description of the missing request. */
  public constructor(request: string) {
    super(`The recording has no exchange for this request: ${request}`);
    this.request = request;
  }
}
