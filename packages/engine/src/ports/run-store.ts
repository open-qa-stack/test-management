import type { RunState } from "@open-qa-stack/domain";
import type { RunReference } from "./run-reference.ts";

/** Where the state of a run is written at its end: the host of the engine says where the runs of a test repository are kept. */
export interface RunStore {
  /**
   * Keeps the state of a run.
   *
   * @param run - The run.
   * @param state - Its state.
   * @throws When the state cannot be kept; the run then throws.
   */
  write(run: RunReference, state: RunState): Promise<void>;
}
