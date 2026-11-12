import { AgentRuntimeError } from "./agent-runtime-error.ts";

/** The model server could not be reached. */
export class ModelUnreachableError extends AgentRuntimeError {
  /** Name of the error class, kept when the error is serialised. */
  public override readonly name = "ModelUnreachableError";
  /** Address that was tried. */
  public readonly url: string;

  /** @param url - Address that was tried. */
  public constructor(url: string) {
    super(`Cannot reach the model at ${url}.`);
    this.url = url;
  }
}
