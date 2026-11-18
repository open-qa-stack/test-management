import type { RunState } from "@open-qa-stack/domain";
import type { RunReference, RunStore, StoredState } from "../src/index.ts";

/** The states of the runs of a test repository, kept in memory as JSON would give them back. */
export class MemoryRunStore implements RunStore {
  /** What is kept for each run, by its identifier. */
  public readonly states = new Map<string, unknown>();

  public location(run: RunReference): string {
    return `memory:${run.runId}`;
  }

  public async read(run: RunReference): Promise<StoredState> {
    return { where: this.location(run), state: this.states.get(run.runId) };
  }

  public async readAll(): Promise<readonly unknown[]> {
    return [...this.states.values()];
  }

  public async write(run: RunReference, state: RunState): Promise<void> {
    this.states.set(run.runId, JSON.parse(JSON.stringify(state)));
  }
}
