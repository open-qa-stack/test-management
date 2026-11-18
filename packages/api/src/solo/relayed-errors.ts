/**
 * The errors a run tells twice: the harness journals an error in the trace of its phase, and the command
 * relays it in the journal of the run once the step is over. An error the command journals itself, such as
 * what stopped a step before its agents worked, is in no trace.
 *
 * @remarks
 * The two are matched on their message, counted: the same message journaled by two passes is two errors.
 * Either side may come first, since the command may relay an error within the millisecond the harness traced it.
 */
export class RelayedErrors {
  /** By message, how many more times the traces told it than the journal; negative when the journal is ahead. */
  readonly #ahead = new Map<string, number>();

  /**
   * Counts an error a trace tells.
   *
   * @param message - Its message, as the command relays it.
   * @returns Whether it is still to be told: `false` when the journal told it already.
   */
  traced(message: string): boolean {
    return this.#count(message, 1);
  }

  /**
   * Counts an error the journal of the run tells.
   *
   * @param message - Its message.
   * @returns Whether it is still to be told: `false` when a trace told it already.
   */
  relayed(message: string): boolean {
    return this.#count(message, -1);
  }

  #count(message: string, side: 1 | -1): boolean {
    const ahead = this.#ahead.get(message) ?? 0;
    this.#ahead.set(message, ahead + side);
    return ahead * side >= 0;
  }
}
