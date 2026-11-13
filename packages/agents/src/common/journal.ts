/** An entry of the journal of a run. */
export interface JournalEntry {
  /** `error` for what kept the index from being written or a tool from answering, `info` otherwise. */
  readonly level: "info" | "error";
  /** What happened, without any secret. */
  readonly message: string;
  /** The source concerned, when there is one. */
  readonly source?: string;
}

/**
 * The journal of a run: what the harness checked, refused and wrote, in order.
 *
 * @remarks
 * Messages come from the harness and its tools, which never repeat a connection string, a key or a
 * password.
 */
export class Journal {
  private readonly lines: JournalEntry[] = [];

  /**
   * Adds an entry.
   *
   * @param level - How serious it is.
   * @param message - What happened.
   * @param source - The source concerned, when there is one.
   */
  public record(level: JournalEntry["level"], message: string, source?: string): void {
    this.lines.push(source === undefined ? { level, message } : { level, message, source });
  }

  /**
   * The entries recorded so far.
   *
   * @returns A copy, in order.
   */
  public entries(): JournalEntry[] {
    return [...this.lines];
  }
}
