import type { RunEntry } from "@open-qa-stack/domain";
import type { JournalOutput } from "../ports/journal-output.ts";

/**
 * The journal of a run as its session tells it: each entry goes to the thread of the session once the run
 * has its journal kept.
 *
 * @remarks
 * The entries of the configuration are written before the secrets it declares are known, and the run gives
 * them again, masked, when it has its journal kept: they are held until then, and told masked. A run the
 * configuration or the prerequisites stopped never has its journal kept: its host then releases what was
 * held, as the command line prints it, since those entries are all that says why the session stopped.
 */
export class SessionJournal implements JournalOutput {
  readonly #session: string;
  readonly #tell: (entry: RunEntry) => void;
  /** The entries written so far, until the journal is kept or released. */
  #held: RunEntry[] | undefined = [];

  /**
   * @param session - The identifier of the session.
   * @param tell - Receives each entry, in order, once it may be told.
   */
  constructor(session: string, tell: (entry: RunEntry) => void) {
    this.#session = session;
    this.#tell = tell;
  }

  /** @returns What names the journal of the session: its events, where the rest of its thread is read. */
  location(): string {
    return `sessions/${this.#session}/events`;
  }

  /** {@inheritDoc JournalOutput.keep} */
  keep(_run: unknown, earlier: readonly RunEntry[]): void {
    this.#open(earlier);
  }

  /** {@inheritDoc JournalOutput.entry} */
  entry(entry: RunEntry): void {
    if (this.#held === undefined) this.#tell(entry);
    else this.#held.push(entry);
  }

  /** Tells the entries still held, as they were written: those of a run that ended before its journal was kept. */
  release(): void {
    this.#open(this.#held ?? []);
  }

  /** Tells entries, then each one that follows as it is written. */
  #open(entries: readonly RunEntry[]): void {
    this.#held = undefined;
    for (const entry of entries) this.#tell(entry);
  }
}
