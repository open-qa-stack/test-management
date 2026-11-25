/** A change a domain cannot take, or a session kept to a domain that is excluded. Its message says why, and what to do. */
export class DomainRefusedError extends Error {
  /** @param message - Why, and what to do. */
  constructor(message: string) {
    super(message);
    this.name = "DomainRefusedError";
  }
}
