/** Where the lines of a log come from. */
export interface LogSource {
  /**
   * Reads the lines of the log, in the order they were written, from a little before an instant.
   *
   * @param since - The instant, in milliseconds since the epoch; earlier lines may come too.
   * @returns The lines, and whether some were left out because the log was too large to read whole.
   * @throws Error when the log cannot be read.
   */
  lines(since: number): Promise<LogLines>;
}

/** The lines a source read. */
export interface LogLines {
  /** The lines, in the order they were written. */
  readonly lines: AsyncIterable<string> | Iterable<string>;
  /** Whether lines were left out because the log was too large to read whole. */
  readonly cut: boolean;
}
