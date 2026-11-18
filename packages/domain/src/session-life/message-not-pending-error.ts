/** Raised when a message is marked delivered that its session does not hold, or that an agent already received. */
export class MessageNotPendingError extends Error {
  /**
   * @param id - The identifier of the session.
   * @param number - The number of the message.
   */
  constructor(id: string, number: number) {
    super(`The session ${id} holds no pending message ${number}.`);
    this.name = "MessageNotPendingError";
  }
}
