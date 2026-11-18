/**
 * The sessions that wait their turn in this process, in the order they were asked for: one session runs at a
 * time, since two runs in the same test repository would write on each other's branch.
 *
 * @remarks
 * The store keeps the sessions that wait as `queued`; this is the order they are started in, held in memory
 * and made again from the store when the process starts.
 */
export class WaitingSessions {
  readonly #waiting: string[] = [];

  /**
   * Puts a session at the end of the line.
   *
   * @param session - The identifier of the session.
   */
  add(session: string): void {
    this.#waiting.push(session);
  }

  /**
   * @param session - The identifier of a session.
   * @returns Whether the session waits in this process.
   */
  has(session: string): boolean {
    return this.#waiting.includes(session);
  }

  /**
   * Takes the session that waited the longest out of the line.
   *
   * @returns Its identifier; `undefined` when no session waits.
   */
  next(): string | undefined {
    return this.#waiting.shift();
  }

  /**
   * Takes a session out of the line, wherever it stands: it was interrupted while it waited.
   *
   * @param session - The identifier of the session; one that does not wait changes nothing.
   */
  remove(session: string): void {
    const at = this.#waiting.indexOf(session);
    if (at >= 0) this.#waiting.splice(at, 1);
  }
}
