import {
  UnknownExecutionError,
  type Execution,
  type ExecutionList,
  type ExecutionQuery,
  type ExecutionStorePort,
  type TestExecution,
} from "@open-qa-stack/domain";

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

  page({ limit, before, outcome, since }: ExecutionQuery): Promise<ExecutionList> {
    const latest = this.#latest().filter(
      ({ results, ranAt }) =>
        (outcome === undefined || results.some(({ verdict }) => verdict === "failed") === (outcome === "failing")) && (since === undefined || ranAt >= since),
    );
    const start = before === undefined ? 0 : latest.findIndex(({ id }) => id === before) + 1;
    if (start === 0 && before !== undefined) return Promise.reject(new UnknownExecutionError(before));
    const items = latest.slice(start, start + limit);
    const page = { items, total: latest.length, start };
    return Promise.resolve(start + limit < latest.length ? { ...page, next: items.at(-1)!.id } : page);
  }

  get(id: string): Promise<Execution | undefined> {
    return Promise.resolve(this.#executions.find((execution) => execution.id === id));
  }

  ofFile(path: string, limit: number): Promise<TestExecution[]> {
    const found = this.#latest().flatMap(({ report: _report, results, ...head }) =>
      results.filter((result) => result.path === path).map((result) => ({ ...head, result })),
    );
    return Promise.resolve(found.slice(0, limit));
  }

  reports(): Promise<string[]> {
    return Promise.resolve(this.#executions.map(({ report }) => report));
  }

  /** @returns Every execution it keeps, the latest kept first: what a test reads to see what was kept. */
  all(): Execution[] {
    return this.#latest();
  }

  /** The executions, the latest kept first. */
  #latest(): Execution[] {
    return [...this.#executions].reverse();
  }
}
