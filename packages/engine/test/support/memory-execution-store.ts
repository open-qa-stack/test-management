import type { Execution, ExecutionStorePort } from "@open-qa-stack/domain";

/** The store of the executions of tests kept in memory, by the rule of the port: what the operations are tested on, without a database. */
export class MemoryExecutionStore implements ExecutionStorePort {
  readonly #executions: Execution[] = [];
  /** Why the store refuses what it is given, when a test makes it refuse. */
  refusal: unknown;

  add(execution: Execution): Promise<void> {
    // oxlint-disable-next-line prefer-promise-reject-errors -- a test makes the store refuse with what is no error too.
    if (this.refusal !== undefined) return Promise.reject(this.refusal);
    this.#executions.push(execution);
    return Promise.resolve();
  }

  list(): Promise<Execution[]> {
    return Promise.resolve([...this.#executions].reverse());
  }
}
