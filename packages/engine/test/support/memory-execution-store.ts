import {
  UnknownExecutionError,
  versionStep,
  type Execution,
  type ExecutionList,
  type ExecutionQuery,
  type ExecutionStorePort,
  type TestExecution,
  type TestVersion,
} from "@open-qa-stack/domain";

/** The store of the executions of tests kept in memory, by the rule of the port: what the operations are tested on, without a database. */
export class MemoryExecutionStore implements ExecutionStorePort {
  readonly #executions: Execution[] = [];
  readonly #versions: TestVersion[] = [];
  /** Why the store refuses what it is given, when a test makes it refuse. */
  refusal: unknown;

  add(execution: Execution): Promise<void> {
    // oxlint-disable-next-line prefer-promise-reject-errors -- a test makes the store refuse with what is no error too.
    if (this.refusal !== undefined) return Promise.reject(this.refusal);
    const { commit, ranAt } = execution;
    const results = execution.results.map((result) => {
      const { path, title, testDigest, committed } = result;
      if (testDigest === undefined) return result;
      const latest = this.#versions.findLast((version) => version.path === path && version.title === title);
      const step = versionStep(latest, testDigest, committed === true ? commit : undefined);
      if (step.kind === "next")
        this.#versions.push({
          path,
          title,
          number: step.number,
          digest: testDigest,
          ...(step.commit === undefined ? {} : { commit: step.commit }),
          since: ranAt,
          executions: 0,
        });
      if (step.kind === "committed") this.#versions[this.#versions.indexOf(latest!)] = { ...latest!, commit: step.commit };
      return { ...result, version: step.number };
    });
    this.#executions.push({ ...execution, results });
    return Promise.resolve();
  }

  page({ limit, before, outcome, origin, campaign, since }: ExecutionQuery): Promise<ExecutionList> {
    const latest = this.#latest().filter(
      ({ results, ranAt, origin: from, campaignId }) =>
        (origin === undefined || from === origin) &&
        (campaign === undefined || campaignId === campaign) &&
        (outcome === undefined || results.some(({ verdict }) => verdict === "failed") === (outcome === "failing")) &&
        (since === undefined || ranAt >= since),
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

  versions(path: string): Promise<TestVersion[]> {
    const versions = this.#versions
      .filter((version) => version.path === path)
      .map((version) => ({
        ...version,
        executions: this.#executions.filter(({ results }) =>
          results.some(({ path: of, title, version: number }) => of === path && title === version.title && number === version.number),
        ).length,
      }));
    return Promise.resolve(
      versions.toSorted((left, right) => right.since.localeCompare(left.since) || left.title.localeCompare(right.title) || right.number - left.number),
    );
  }

  ofCampaign(campaignId: string): Promise<Execution[]> {
    return Promise.resolve(this.#executions.filter((execution) => execution.campaignId === campaignId));
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
