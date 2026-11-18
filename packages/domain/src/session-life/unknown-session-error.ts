/** Raised when a command names a session the store does not hold. */
export class UnknownSessionError extends Error {
  /** @param id - The identifier that names no session. */
  constructor(id: string) {
    super(`No session ${id}.`);
    this.name = "UnknownSessionError";
  }
}
