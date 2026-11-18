import { Observable } from "rxjs";
import type { Project, Session, SessionEvent, SessionOpening } from "@open-qa-stack/shared/sessions";

/**
 * Where the sessions of the instance come from: what the routes read them from and open them with.
 *
 * @remarks
 * The routes know nothing else about the sessions. An implementation says nothing of where it keeps them, and
 * raises {@link SessionError} for what a client must be told.
 */
export abstract class SessionSource {
  /** @returns The project of the instance. */
  abstract project(): Promise<Project>;

  /** @returns Every session, the latest first. */
  abstract sessions(): Promise<Session[]>;

  /**
   * @param id - The identifier of a session.
   * @returns The session as it is now; `undefined` when there is none.
   */
  abstract session(id: string): Promise<Session | undefined>;

  /**
   * Follows the events of a session.
   *
   * @param id - The identifier of a session that exists.
   * @param after - The identifier of the last event already known; 0 for every event.
   * @returns The events after that one in the order of their identifiers, then each new one as it happens.
   * It reads only while it is subscribed to, completes once it has passed the event that tells the session is
   * no longer running — at once when that event is already known — and fails when the events can no longer be read.
   */
  abstract events(id: string, after: number): Observable<SessionEvent>;

  /**
   * Opens a session.
   *
   * @param opening - What to test, and where.
   * @returns The session, running.
   * @throws {@link SessionError} `unavailable` when the source cannot open sessions, `session_running` when a
   * session must end first, `not_opened` when the session could not start, `opening_timed_out` when it did
   * not start in time.
   */
  abstract open(opening: SessionOpening): Promise<Session>;
}
