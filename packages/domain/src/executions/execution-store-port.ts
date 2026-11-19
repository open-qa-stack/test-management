import type { Execution } from "./execution.ts";

/** The port of the store of the executions of tests: what the operations on executions ask of what keeps them, whatever keeps them. */
export interface ExecutionStorePort {
  /**
   * Keeps an execution, with what came of each of its tests, all of it or nothing.
   *
   * @param execution - The execution, under an identifier no other one has.
   */
  add(execution: Execution): Promise<void>;

  /** @returns The executions it keeps, the latest first, each with its results. */
  list(): Promise<Execution[]>;
}
