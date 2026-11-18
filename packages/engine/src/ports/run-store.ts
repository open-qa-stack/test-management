import type { RunState } from "@open-qa-stack/domain";
import type { RunReference } from "./run-reference.ts";

/** What a store holds for a run, as it was found. */
export interface StoredState {
  /** Where the store looked, as a person is told when what is there cannot be used. */
  readonly where: string;
  /** What is there, as JSON gives it; `undefined` when nothing can be read. The engine checks that it is the state of a run. */
  readonly state: unknown;
}

/**
 * Where the state of a run is written at its end, and where the state of a run to resume is found: the host
 * of the engine says where the runs of a test repository are kept.
 */
export interface RunStore {
  /**
   * Where the state of a run is kept, as the summary of the run names it.
   *
   * @param run - The run.
   * @returns What names the state, such as a path relative to the test repository.
   */
  location(run: RunReference): string;

  /**
   * What is kept as the state of a run.
   *
   * @param run - The run.
   * @returns What was found, and where.
   */
  read(run: RunReference): Promise<StoredState>;

  /**
   * What is kept as the state of each run of the test repository, for the engine to find the run that resumed another.
   *
   * @param stateDir - The state folder of the test repository, relative to it.
   * @returns What is there for each run, as JSON gives it, `undefined` for one that cannot be read; none when no run was kept.
   */
  readAll(stateDir: string): Promise<readonly unknown[]>;

  /**
   * Keeps the state of a run.
   *
   * @param run - The run.
   * @param state - Its state.
   * @throws When the state cannot be kept; the run then throws.
   */
  write(run: RunReference, state: RunState): Promise<void>;
}
