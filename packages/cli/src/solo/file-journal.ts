import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { entryLine, runJournalFile, RUNS_FOLDER, type RunEntry } from "@open-qa-stack/domain";
import type { JournalOutput, RunReference } from "@open-qa-stack/engine";

/**
 * The journal of a run as the command line gives it: each entry is written as a line on the error output,
 * and, once the run is kept, as a JSON line in its file, `<stateDir>/runs/<run>.jsonl` in the test repository.
 */
export class FileJournal implements JournalOutput {
  private readonly repositoryRoot: string;
  private readonly write: (line: string) => void;
  private file: string | undefined;

  /**
   * @param repositoryRoot - Absolute path of the test repository.
   * @param write - Receives each entry as a line a person reads; the error output of the command.
   */
  public constructor(repositoryRoot: string, write: (line: string) => void) {
    this.repositoryRoot = repositoryRoot;
    this.write = write;
  }

  /** {@inheritDoc @open-qa-stack/engine#JournalOutput.location} */
  public location(run: RunReference): string {
    return posix.join(run.stateDir, RUNS_FOLDER, runJournalFile(run.runId));
  }

  /** {@inheritDoc @open-qa-stack/engine#JournalOutput.keep} */
  public keep(run: RunReference, earlier: readonly RunEntry[]): void {
    const path = join(this.repositoryRoot, this.location(run));
    mkdirSync(dirname(path), { recursive: true });
    this.file = path;
    for (const entry of earlier) appendFileSync(path, `${JSON.stringify(entry)}\n`);
  }

  /** {@inheritDoc @open-qa-stack/engine#JournalOutput.entry} */
  public entry(entry: RunEntry): void {
    this.write(`${entryLine(entry)}\n`);
    if (this.file !== undefined) appendFileSync(this.file, `${JSON.stringify(entry)}\n`);
  }
}
