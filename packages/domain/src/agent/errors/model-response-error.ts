import { AgentRuntimeError } from "./agent-runtime-error.ts";

/** The model server answered, but not with a usable response. */
export class ModelResponseError extends AgentRuntimeError {
  /** Name of the error class, kept when the error is serialised. */
  public override readonly name = "ModelResponseError";
}
