/** A defect asked for that the instance does not keep. */
export class UnknownDefectError extends Error {
  /** @param id - The reference asked for. */
  constructor(id: string) {
    super(`The instance keeps no defect ${id}.`);
    this.name = "UnknownDefectError";
  }
}
