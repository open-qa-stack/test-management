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
 * The events are read when they are subscribed to, then each time the session is notified: the store is
 * never polled. A reading starts after the last event told, so that one that finds nothing new tells no
 * event twice. Nothing follows the end of a session: the events end with the one that tells it — at once
 * when it is at or before the rank given.
 */
export class SessionEventStream {
  readonly #store: Pick<SessionQueries, "eventsAfter">;
  readonly #notifications: EventNotifications;
  readonly #session: string;
  readonly #after: number;

  /**
   * @param store - Where the events are kept.
   * @param notifications - What tells that the session gained events.
   * @param session - The identifier of a session that exists.
   * @param after - The rank of the last event already known; 0 for every event.
   */
  constructor(store: Pick<SessionQueries, "eventsAfter">, notifications: EventNotifications, session: string, after: number) {
    this.#store = store;
    this.#notifications = notifications;
    this.#session = session;
    this.#after = after;
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
    const close = (): void => {
      left = true;
      leave();
    };
    const read = async (): Promise<void> => {
      woken = true;
      // One reading at a time: a session notified while it is read is read once more afterwards.
      if (reading) return;
      reading = true;
      try {
        while (woken && !left) {
          woken = false;
          for (const event of await this.#store.eventsAfter(this.#session, last)) {
            if (left) return;
            // The changes of state told before the last event known are read again, to learn of an end told already.
            if (event.id > last) listener.event(event);
            last = Math.max(last, event.id);
            if (event.type === "state_changed" && isTerminal(event.state)) {
              close();
              return listener.ended();
            }
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
