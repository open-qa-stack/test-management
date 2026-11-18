import type { RunEntry } from "@open-qa-stack/domain";
import type { RunReference } from "./run-reference.ts";

/**
 * Where a run tells what it does, step by step: the host of the engine shows each entry to whoever follows
 * the run, and keeps the journal of a run that went past its prerequisites.
 *
 * @remarks
 * The entries of the configuration come before the secrets it declares are known: `keep` gives them again,
 * masked, so that what is kept holds no secret.
 */
export interface JournalOutput {
  /**
   * Where the journal of a run is kept, as the state of the run names it.
   *
   * @param run - The run.
   * @returns What names the journal, such as a path relative to the test repository.
   */
  location(run: RunReference): string;

  /**
   * Keeps the journal of a run from now on: the run passed its prerequisites, and its entries are worth keeping.
   *
   * @param run - The run.
   * @param earlier - The entries written so far, in order, every secret masked.
   * @throws When the journal cannot be kept; the run stops on it.
   */
  keep(run: RunReference, earlier: readonly RunEntry[]): void;

  /**
   * Receives an entry as it is written.
   *
   * @param entry - The entry, every secret known so far masked.
   * @throws When the entry cannot be written; the step under way stops on it.
   */
  entry(entry: RunEntry): void;
}
