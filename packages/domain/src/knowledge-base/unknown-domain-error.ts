/** A domain asked for that the knowledge does not hold. */
export class UnknownDomainError extends Error {
  /** @param id - The identifier asked for. */
  constructor(id: string) {
    super(`The knowledge has no domain ${id}.`);
    this.name = "UnknownDomainError";
  }
}
