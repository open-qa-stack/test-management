/**
 * Raised when a command reaches a session that no longer goes on: it is completed or interrupted, and takes
 * no message, no event and no other end.
 */
export class SessionEndedError extends Error {
  /** @param id - The identifier of the session. */
  constructor(id: string) {
    super(`The session ${id} no longer goes on.`);
    this.name = "SessionEndedError";
  }
}
