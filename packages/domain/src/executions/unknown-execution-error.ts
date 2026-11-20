/** An execution asked for that the instance does not keep. */
export class UnknownExecutionError extends Error {
  /** @param id - The identifier asked for. */
  constructor(id: string) {
    super(`The instance keeps no execution ${id}.`);
    this.name = "UnknownExecutionError";
  }
}
