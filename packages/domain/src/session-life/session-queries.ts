import type { Project } from "../sessions/project.ts";
import type { SessionEvent } from "../sessions/session-event.ts";
import type { Session } from "../sessions/session.ts";
import type { PendingMessage } from "./pending-message.ts";

/** What is read of the sessions an instance keeps. Reading changes nothing. */
export interface SessionQueries {
  /** @returns The project; one without name nor application when none was saved. */
  project(): Promise<Project>;

  /** @returns Every session, the latest opened first. */
  sessions(): Promise<Session[]>;

  /**
   * @param id - The identifier of a session.
   * @returns The session; `undefined` when there is none.
   */
  session(id: string): Promise<Session | undefined>;

  /**
   * @param id - The identifier of a session.
   * @returns The rank of its last event; 0 when it has none, or does not exist.
   */
  lastRank(id: string): Promise<number>;

  /**
   * Reads what a client that already got the first events of a session is still to be told.
   *
   * @param id - The identifier of a session.
   * @param after - The rank of the last event already told; 0 for every event.
   * @returns In the order of their ranks, the events after that rank, and the changes of state up to it:
   * whoever follows a session must learn that it ended even when that was told before the rank it resumes after.
   */
  eventsAfter(id: string, after: number): Promise<SessionEvent[]>;

  /**
   * @param id - The identifier of a session.
   * @returns The messages of the person no agent received yet, in the order of their numbers; none when the
   * session does not exist.
   */
  pendingMessages(id: string): Promise<PendingMessage[]>;

  /**
   * @param host - What names a process that hosts sessions.
   * @returns The identifiers of the sessions it hosts that go on and whose interruption another process asked for.
   */
  interruptionRequests(host: string): Promise<string[]>;
}
