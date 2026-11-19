import type { Execution, ExecutionStorePort } from "@open-qa-stack/domain";

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

  /** @returns The executions, the latest first, each with what came of each of its tests. */
  list(): Promise<Execution[]> {
    return this.#store.list();
  }
}
