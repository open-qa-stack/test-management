import type { SessionCommand } from "./session-command.ts";

/**
 * Raised when a command reaches a session that goes on in a state the command is not for: a session that
 * still waits is told an event, or one that runs is started again.
 */
export class SessionStateError extends Error {
  /**
   * @param id - The identifier of the session.
   * @param command - The command that was refused.
   * @param state - The state the session is in.
   */
  constructor(id: string, command: SessionCommand, state: string) {
    super(`The session ${id} takes no ${command} while it is ${state}.`);
    this.name = "SessionStateError";
  }
}
