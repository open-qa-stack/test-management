import type { Project } from "../sessions/project.ts";
import type { AgentRole } from "../sessions/session-event.ts";
import type { MessageReceipt, Session, SessionOpening, SessionResult } from "../sessions/session.ts";
import type { UnrankedEvent } from "../sessions/unranked-event.ts";

/**
 * What changes the sessions an instance keeps: one command for each step of the life of a session, which
 * `SESSION_LIFE` states.
 *
 * @remarks
 * Each command happens whole or not at all. Two commands on the same session run one after the other: each
 * event takes the rank that follows the last, and each message the number that follows the last, without a
 * gap nor a rank given twice.
 */
export interface SessionCommands {
  /**
   * Saves the project, in place of the one saved before.
   *
   * @param saved - The project as it is now.
   */
  saveProject(saved: Project): Promise<void>;

  /**
   * Asks for a session: it waits, `queued`, until its host starts it, and its first event is what the person asked.
   *
   * @param opening - What to test, and where.
   * @returns The session, under the identifier it was given.
   */
  ask(opening: SessionOpening): Promise<Session>;

  /**
   * Starts a session that waits: it becomes `running`, and an event tells so.
   *
   * @param id - The identifier of the session.
   * @returns The session, now running.
   * @throws `UnknownSessionError` when there is no such session.
   * @throws `SessionEndedError` when the session no longer goes on.
   * @throws `SessionStateError` when the session runs already.
   */
  start(id: string): Promise<Session>;

  /**
   * Appends to a session that runs the events its work tells, at the ranks that follow its last event.
   *
   * @param id - The identifier of the session.
   * @param events - The events, in order.
   * @throws `UnknownSessionError` when there is no such session.
   * @throws `SessionEndedError` when the session no longer goes on: its work must stop.
   * @throws `SessionStateError` when the session still waits.
   */
  append(id: string, events: readonly UnrankedEvent[]): Promise<void>;

  /**
   * Ends a session whose work went to its end: it becomes `completed` with its result, and an event tells so.
   *
   * @param id - The identifier of the session.
   * @param result - What the session came to.
   * @throws `UnknownSessionError` when there is no such session.
   * @throws `SessionEndedError` when the session had already ended.
   * @throws `SessionStateError` when the session still waits.
   */
  complete(id: string, result: SessionResult): Promise<void>;

  /**
   * Ends a session whose work stopped before its end, or never started: it becomes `interrupted`, and an event
   * tells so.
   *
   * @param id - The identifier of the session.
   * @throws `UnknownSessionError` when there is no such session.
   * @throws `SessionEndedError` when the session had already ended.
   */
  interrupt(id: string): Promise<void>;

  /**
   * Takes a message a person sends to a session that goes on: the message waits for an agent under the number
   * that follows the last of its session, and an event tells it with that number.
   *
   * @param id - The identifier of the session.
   * @param text - What the person says to the agents.
   * @returns The receipt, which numbers the message in the session.
   * @throws `UnknownSessionError` when there is no such session.
   * @throws `SessionEndedError` when the session no longer goes on.
   */
  say(id: string, text: string): Promise<MessageReceipt>;

  /**
   * Marks a pending message of a session that runs as handed to an agent, which an event tells. A message is
   * delivered once.
   *
   * @param id - The identifier of the session.
   * @param number - The number of the message.
   * @param agent - The agent that received it.
   * @throws `UnknownSessionError` when there is no such session.
   * @throws `SessionEndedError` when the session no longer goes on.
   * @throws `SessionStateError` when the session still waits.
   * @throws `MessageNotPendingError` when the session holds no such message, or an agent already received it.
   */
  deliver(id: string, number: number, agent: AgentRole): Promise<void>;

  /**
   * Ends the sessions a process that died left: every `running` session becomes `interrupted`, and an event
   * tells so. A session that waits is left to wait. The host of the sessions sends it when it starts, before
   * it runs any: nothing runs then, whatever the store holds.
   *
   * @returns The identifiers of the sessions that were interrupted.
   */
  abandonRunning(): Promise<string[]>;
}
