/** A move of a defect its life does not allow from where it stands, with where it can go. */
export class DefectRefusedError extends Error {
  /** @param message - Why, and what can be done instead. */
  constructor(message: string) {
    super(message);
    this.name = "DefectRefusedError";
  }
}
