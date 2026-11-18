import { entryLine, type RunEntry } from "@open-qa-stack/domain";
import type { JournalOutput, RunReference } from "../src/index.ts";

/** The journal of a run, kept in memory: what a person would read of it, and the entries kept once the run asked to keep them. */
export class MemoryJournal implements JournalOutput {
  /** Each entry as a line, in the order they were written. */
  public lines = "";
  private readonly kept: Map<string, RunEntry[]>;
  private keeping: RunEntry[] | undefined;

  /** @param kept - The journal kept of each run, by its identifier. */
  public constructor(kept: Map<string, RunEntry[]>) {
    this.kept = kept;
  }

  public location(run: RunReference): string {
    return `memory:${run.runId}.journal`;
  }

  public keep(run: RunReference, earlier: readonly RunEntry[]): void {
    this.keeping = [...earlier];
    this.kept.set(run.runId, this.keeping);
  }

  public entry(entry: RunEntry): void {
    this.lines += `${entryLine(entry)}\n`;
    this.keeping?.push(entry);
  }
}
