import { AgentRuntimeError } from "./agent-runtime-error.ts";

/** The model server refused the key it was given: the key is wrong, revoked, or lacks a right. */
export class ModelKeyRefusedError extends AgentRuntimeError {
  public override readonly name = "ModelKeyRefusedError";
  /** The status the server answered with: `401` or `403`. */
  public readonly status: number;

  /** @param status - The status the server answered with. */
  public constructor(status: number) {
    super(`The model server refused the key, with status ${status}: check the key its variable holds; oqas model status tests it.`);
    this.status = status;
  }
}
