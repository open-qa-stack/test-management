/**
 * Tells, in the memory of the process, that a session gained events: whoever writes to the store of the
 * sessions says so here once the store took the write, and whoever follows the session is woken.
 *
 * @remarks
 * A notification names a session and carries nothing: a follower reads what the store holds. Nothing listens
 * to the database, since the process that writes the events is the one that serves them.
 */
export class EventNotifications {
  readonly #followers = new Map<string, Set<() => void>>();

  /**
   * Follows a session.
   *
   * @param session - The identifier of the session.
   * @param wake - Called each time the session is notified.
   * @returns What stops following.
   */
  follow(session: string, wake: () => void): () => void {
    const followers = this.#followers.get(session) ?? new Set<() => void>();
    this.#followers.set(session, followers.add(wake));
    return () => {
      followers.delete(wake);
      // Others may follow the session since under a set of their own: only the set that emptied is forgotten.
      if (followers.size === 0 && this.#followers.get(session) === followers) this.#followers.delete(session);
    };
  }

  /**
   * Wakes whoever follows a session.
   *
   * @param session - The identifier of the session, which gained events.
   */
  notify(session: string): void {
    for (const wake of this.#followers.get(session) ?? []) wake();
  }
}
