import type { RunState } from "@open-qa-stack/domain";
import type { RunReference, RunStore } from "../src/index.ts";

/** The states of the runs of a test repository, kept in memory as JSON would give them back. */
export class MemoryRunStore implements RunStore {
  /** What is kept for each run, by its identifier. */
  public readonly states = new Map<string, unknown>();

  public async write(run: RunReference, state: RunState): Promise<void> {
    this.states.set(run.runId, JSON.parse(JSON.stringify(state)));
  }
}
