import type { Execution, ExecutionList, ExecutionQuery, TestExecution } from "./execution.ts";
import type { TestVersion } from "./test-version.ts";

/** The port of the store of the executions of tests: what the operations on executions ask of what keeps them, whatever keeps them. */
export interface ExecutionStorePort {
  /**
   * Keeps an execution, with what came of each of its tests, all of it or nothing: each result with a digest of its
   * test is kept under the version of the test it ran at, by the rule of `versionStep`, whatever version it gives.
   *
   * @param execution - The execution, under an identifier no other one has.
   */
  add(execution: Execution): Promise<void>;

  /**
   * @param query - Which executions, and how many.
   * @returns A page of the executions, the latest first, each with its results.
   * @throws `UnknownExecutionError` when the query starts after an execution it does not keep.
   */
  page(query: ExecutionQuery): Promise<ExecutionList>;

  /** @returns The execution of an identifier with its results, each with what came of its test before; `undefined` when it keeps none under it. */
  get(id: string): Promise<Execution | undefined>;

  /**
   * @param path - The path of a file of tests, relative to the root of the test repository.
   * @param limit - How many results at most.
   * @returns What came of the tests of the file in each execution that ran them, the latest first.
   */
  ofFile(path: string, limit: number): Promise<TestExecution[]>;

  /**
   * @param path - The path of a file of tests, relative to the root of the test repository.
   * @returns The versions of its tests, the latest first, then by their titles.
   */
  versions(path: string): Promise<TestVersion[]>;

  /** @returns The executions of a campaign, each with its results, in any order. */
  ofCampaign(campaignId: string): Promise<Execution[]>;

  /** @returns The report of each execution it keeps, relative to the test repository. */
  reports(): Promise<string[]>;
}
