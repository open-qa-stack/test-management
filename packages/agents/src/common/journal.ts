/** An entry of the journal of a run. */
export interface JournalEntry {
  /** `error` for what kept the knowledge base from being written or a tool from answering, `info` otherwise. */
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
  private readonly onRecord: ((entry: JournalEntry) => void) | undefined;

  /** @param onRecord - Receives each entry recorded, as it is. */
  public constructor(onRecord?: (entry: JournalEntry) => void) {
    this.onRecord = onRecord;
  }

  /**
   * Adds an entry.
   *
   * @param level - How serious it is.
   * @param message - What happened.
   * @param source - The source concerned, when there is one.
   */
  public record(level: JournalEntry["level"], message: string, source?: string): void {
    const entry = source === undefined ? { level, message } : { level, message, source };
    this.lines.push(entry);
    this.onRecord?.(entry);
  }

  /**
   * Adds entries recorded by another journal, which already handed them on.
   *
   * @param entries - The entries, in order.
   */
  public adopt(entries: readonly JournalEntry[]): void {
    this.lines.push(...entries);
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
