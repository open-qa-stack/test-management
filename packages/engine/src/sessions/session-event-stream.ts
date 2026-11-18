import { isTerminal, type SessionQueries } from "@open-qa-stack/domain";
import type { SessionEvent } from "@open-qa-stack/domain/sessions";
import type { EventNotifications } from "./event-notifications.ts";

/** Who follows the events of a session: called for each event, in order, then once for how they ended. */
export interface EventListener {
  /** Receives an event of the session. */
  event(event: SessionEvent): void;
  /** Called once the session ended, after the event that told so: no event follows. */
  ended(): void;
  /** Called when the events can no longer be read: no event follows. */
  failed(error: unknown): void;
}

/**
 * The events of a session from a rank on: those the store holds, then each new one as it is notified, until
 * the session ended.
 *
 * @remarks
 * The events are read when they are subscribed to, then each time the session is notified. A session this
 * process hosts is notified in its memory, and the store is never polled for it. A session another process
 * hosts is notified by no one: the store is then read again at a pace, as long as the session is followed. A
 * reading starts after the last event told, so that one that finds nothing new tells no event twice. Nothing
 * follows the end of a session: the events end with the one that tells it — at once when it is at or before
 * the rank given. An end a person resumed the session from is not its end: the events go on through it.
 */
export class SessionEventStream {
  readonly #store: Pick<SessionQueries, "eventsAfter">;
  readonly #notifications: EventNotifications;
  readonly #session: string;
  readonly #after: number;
  readonly #everyMs: number | undefined;

  /**
   * @param store - Where the events are kept.
   * @param notifications - What tells that the session gained events.
   * @param session - The identifier of a session that exists.
   * @param after - The rank of the last event already known; 0 for every event.
   * @param everyMs - How often the store is read again, in milliseconds, for a session no notification tells
   * of; `undefined` for a session this process hosts.
   */
  constructor(store: Pick<SessionQueries, "eventsAfter">, notifications: EventNotifications, session: string, after: number, everyMs?: number) {
    this.#store = store;
    this.#notifications = notifications;
    this.#session = session;
    this.#after = after;
    this.#everyMs = everyMs;
  }

  /**
   * Follows the events.
   *
   * @param listener - Receives the events after the rank given, in the order of their ranks, then how they ended.
   * @returns What stops following: the listener is called no more, and the session is no longer followed. The
   * events release it by themselves when they end or fail.
   */
  subscribe(listener: EventListener): () => void {
    let last = this.#after;
    let reading = false;
    let woken = false;
    let left = false;
    const leave = this.#notifications.follow(this.#session, () => void read());
    const again = this.#everyMs === undefined ? undefined : setInterval(() => void read(), this.#everyMs);
    const close = (): void => {
      left = true;
      leave();
      clearInterval(again);
    };
    const read = async (): Promise<void> => {
      woken = true;
      // One reading at a time: a session notified while it is read is read once more afterwards.
      if (reading) return;
      reading = true;
      try {
        while (woken && !left) {
          woken = false;
          const events = await this.#store.eventsAfter(this.#session, last);
          // The changes of state told before the last event known are read again, to learn of an end told already. A
          // session a person resumed went on after its end: only the last change of state tells whether it ended.
          const change = events.findLast((event) => event.type === "state_changed");
          for (const event of events) {
            if (left) return;
            if (event.id > last) listener.event(event);
            last = Math.max(last, event.id);
          }
          if (left) return;
          if (change !== undefined && isTerminal(change.state)) {
            close();
            return listener.ended();
          }
        }
      } catch (error) {
        if (left) return;
        close();
        listener.failed(error);
      } finally {
        reading = false;
      }
    };
    void read();
    return close;
  }
}
