/** A change of the memory that cannot be made, with why. */
export class MemoryRefusedError extends Error {
  /** @param message - Why, and what can be done instead. */
  constructor(message: string) {
    super(message);
    this.name = "MemoryRefusedError";
  }
}
