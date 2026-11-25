import {
  UnknownExecutionError,
  type Execution,
  type ExecutionList,
  type ExecutionQuery,
  type ExecutionStorePort,
  type TestExecution,
  type LastVerdict,
  type TestVersion,
} from "@open-qa-stack/domain";

/** How many executions of the tests of a file are read at most, the latest ones. */
export const FILE_EXECUTIONS_LIMIT = 100;

/**
 * The operations on the executions of tests the instance keeps. Whatever shows them — a REST API, a terminal — calls
 * these and holds no rule of its own.
 */
export class Executions {
  readonly #store: ExecutionStorePort;

  /** @param store - Where the executions are kept. */
  constructor(store: ExecutionStorePort) {
    this.#store = store;
  }

  /**
   * @param query - Which executions, and how many.
   * @returns A page of the executions, the latest first, each with what came of each of its tests.
   * @throws `UnknownExecutionError` when the page starts after an execution the instance does not keep.
   */
  page(query: ExecutionQuery): Promise<ExecutionList> {
    return this.#store.page(query);
  }

  /**
   * @param id - The identifier of an execution.
   * @returns The execution, with what came of each of its tests.
   * @throws `UnknownExecutionError` when the instance keeps none under the identifier.
   */
  async get(id: string): Promise<Execution> {
    const execution = await this.#store.get(id);
    if (execution === undefined) throw new UnknownExecutionError(id);
    return execution;
  }

  /**
   * @param path - The path of a file of tests, relative to the root of the test repository.
   * @returns What came of its tests in the latest executions that ran them, at most {@link FILE_EXECUTIONS_LIMIT}, the latest first.
   */
  ofFile(path: string): Promise<TestExecution[]> {
    return this.#store.ofFile(path, FILE_EXECUTIONS_LIMIT);
  }

  /** @returns What came of each test the last time an execution ran it and did not skip it, by path then title. */
  verdicts(): Promise<LastVerdict[]> {
    return this.#store.verdicts();
  }

  /**
   * @param path - The path of a file of tests, relative to the root of the test repository.
   * @returns The versions of its tests, the latest first, then by their titles, each with how many executions ran it.
   */
  versions(path: string): Promise<TestVersion[]> {
    return this.#store.versions(path);
  }
}
