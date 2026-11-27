/** A lesson or a memory the instance keeps none of under the identifier asked. */
export class UnknownMemoryError extends Error {
  /** @param id - The identifier asked. */
  constructor(id: string) {
    super(`The instance keeps no lesson nor memory ${id}.`);
    this.name = "UnknownMemoryError";
  }
}
