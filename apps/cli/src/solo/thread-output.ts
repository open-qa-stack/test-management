import type { SessionEvent, SessionPhase } from "@open-qa-stack/domain/sessions";
import { eventLine, ofTheAgents } from "./event-line.ts";
import type { Output } from "./arguments.ts";
import type { CommandOutput } from "./command-io.ts";

/**
 * Prints the thread of a session, an event at a time, as the command was asked to: lines a person reads, or
 * JSON Lines a program reads.
 *
 * @remarks
 * As JSON Lines, every event goes to the output whole, in the format of the contract of sessions, one a line,
 * and nothing else is written there. As lines to read, what the harness tells of the session is always
 * written, and what the agents do only when the thread is followed. The thread also remembers the last phase
 * it saw start, which tells how a session that was interrupted stopped.
 */
export class ThreadOutput {
  readonly #to: CommandOutput;
  readonly #format: Output;
  readonly #follow: boolean;
  #phase: SessionPhase | undefined;

  /**
   * @param to - Where the thread is written.
   * @param format - Lines to read, or JSON Lines.
   * @param follow - Whether to write what the agents do, among the lines to read.
   */
  constructor(to: CommandOutput, format: Output, follow: boolean) {
    this.#to = to;
    this.#format = format;
    this.#follow = follow;
  }

  /** @returns The last phase the thread said started; `undefined` when it said none. */
  get lastPhase(): SessionPhase | undefined {
    return this.#phase;
  }

  /**
   * Prints an event of the thread.
   *
   * @param event - The event, in the order of the thread.
   */
  event(event: SessionEvent): void {
    if (event.type === "phase_started") this.#phase = event.phase;
    if (this.#format === "json") this.#to.write(`${JSON.stringify(event)}\n`);
    else if (this.#follow || !ofTheAgents(event)) this.#to.write(`${eventLine(event)}\n`);
  }
}
