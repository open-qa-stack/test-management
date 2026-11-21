import type { Project } from "../sessions/project.ts";
import type { AgentRole } from "../sessions/session-event.ts";
import type { MappingOpening, MessageReceipt, Session, SessionOpening, SessionResult } from "../sessions/session.ts";
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
   * Asks for a session: it waits, `queued`, until its host starts it, and its first event is what the person asked; a
   * session that maps the knowledge, which no person asked, starts with no event.
   *
   * @param opening - What to test, and where; or the knowledge to map, in an environment.
   * @param host - What names the process that asks: the host of the session, which this is its first beat on.
   * @returns The session, under the identifier it was given.
   */
  ask(opening: SessionOpening | MappingOpening, host: string): Promise<Session>;

  /**
   * Starts a session that waits: it becomes `running`, and an event tells so. Whoever starts it is its host
   * from then on.
   *
   * @param id - The identifier of the session.
   * @param host - What names the process that starts it.
   * @returns The session, now running.
   * @throws `UnknownSessionError` when there is no such session.
   * @throws `SessionEndedError` when the session no longer goes on.
   * @throws `SessionStateError` when the session runs already.
   */
  start(id: string, host: string): Promise<Session>;

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
   * Ends a session whose work went to its end: it becomes `completed` with its result, and an event tells so
   * with that result.
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
   * Resumes a session that ended with what a person says more to it: it waits, `queued`, for its host to start
   * a new turn of work on that message, which an event tells as what was asked of the turn, without a number,
   * then another the change of state. The process that resumes it is its host from then on; the result of the
   * turn before is no longer the result of the session, which its completion told, and an interruption asked
   * while that turn ran is forgotten.
   *
   * @param id - The identifier of the session.
   * @param text - What the person asks of the new turn.
   * @param host - What names the process that resumes it.
   * @returns The session, now waiting.
   * @throws `UnknownSessionError` when there is no such session.
   * @throws `SessionStateError` when the session goes on: it takes a message instead.
   */
  resume(id: string, text: string, host: string): Promise<Session>;

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
   * Asks, from a process that may not be the one that runs it, that a session that goes on be interrupted. One
   * that waits is interrupted at once, and so is one whose host went silent: nobody would do it. For one that
   * runs under a host that beats, the request is kept: its host reads it, stops the run and interrupts the session.
   *
   * @param id - The identifier of the session.
   * @param silentForMs - How long without a beat tells that a host died, in milliseconds.
   * @throws `UnknownSessionError` when there is no such session.
   * @throws `SessionEndedError` when the session had already ended.
   */
  requestInterruption(id: string, silentForMs: number): Promise<void>;

  /**
   * Tells that a host is alive: each session it hosts that goes on bears the date of this beat.
   *
   * @param host - What names the process.
   */
  beat(host: string): Promise<void>;

  /**
   * Withdraws the beats of a host that stops: the sessions it still hosts read as left by a silent host at
   * once, without waiting for the time a silence takes.
   *
   * @param host - What names the process.
   */
  release(host: string): Promise<void>;

  /**
   * Gives a host that stays the sessions that wait for a host that went silent: they wait for it from then on.
   *
   * @param host - What names the process that takes them over.
   * @param silentForMs - How long without a beat tells that a host died, in milliseconds.
   * @returns The identifiers of the sessions taken over, in the order they were asked for.
   */
  takeOver(host: string, silentForMs: number): Promise<string[]>;

  /**
   * Ends the sessions a host that died left: every `running` session whose host went silent becomes
   * `interrupted`, and an event tells so. A session whose host beats is left to it, and one that waits is left
   * to wait.
   *
   * @param silentForMs - How long without a beat tells that a host died, in milliseconds.
   * @returns The identifiers of the sessions that were interrupted.
   */
  abandonSilent(silentForMs: number): Promise<string[]>;
}
