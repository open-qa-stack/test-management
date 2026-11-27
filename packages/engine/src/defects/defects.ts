import {
  UnknownDefectError,
  type Defect,
  type DefectList,
  type DefectReport,
  type DefectStage,
  type DefectStatus,
  type DefectStorePort,
  type ExecutionStorePort,
  type ListedDefect,
} from "@open-qa-stack/domain";

/** How many of the latest executions of the file of a test are read to tell whether it passed since its defect was fixed. */
const READ_EXECUTIONS = 20;

/**
 * The operation of the defects a person reported from a test that failed, kept by the instance: no tool of tickets is
 * called. Whatever shows them — the console through the API, the command — calls it and holds no rule of its own.
 *
 * @remarks
 * A defect is open until the person marks it fixed; once fixed, its test is to run again until an execution after the
 * fix ran it and it passed, and it then counts with those closed. The person may close it, or open it again.
 */
export class Defects {
  readonly #store: DefectStorePort;
  readonly #executions: Pick<ExecutionStorePort, "ofFile">;
  readonly #now: () => Date;

  /**
   * @param store - What keeps the defects.
   * @param executions - The executions the instance keeps, which tell whether the test of a defect fixed passed since.
   * @param now - The clock the defects are dated by.
   */
  constructor(store: DefectStorePort, executions: Pick<ExecutionStorePort, "ofFile">, now: () => Date = () => new Date()) {
    this.#store = store;
    this.#executions = executions;
    this.#now = now;
  }

  /** @returns The defects, the latest reported first, each with where it stands, and how many each view holds. */
  async list(): Promise<DefectList> {
    const items = await Promise.all((await this.#store.list()).map((defect) => this.#listed(defect)));
    return {
      items,
      counts: {
        open: items.filter(({ stage }) => stage === "open").length,
        toReplay: items.filter(({ stage }) => stage === "to_replay").length,
        closed: items.filter(({ stage }) => stage === "closed" || stage === "replayed").length,
      },
    };
  }

  /**
   * Keeps a defect a person reports of a test, open.
   *
   * @param report - What they report.
   * @returns The defect kept, under its reference.
   */
  async report(report: DefectReport): Promise<ListedDefect> {
    return { ...(await this.#store.add(report, this.#now().toISOString())), stage: "open" };
  }

  /**
   * Moves a defect: fixed, closed, or open again, which forgets when it was fixed and closed.
   *
   * @param id - Its reference.
   * @param status - Where it stands now.
   * @returns The defect as it stands.
   * @throws UnknownDefectError when the instance keeps no defect of the reference.
   */
  async change(id: string, status: DefectStatus): Promise<ListedDefect> {
    const defect = await this.#store.get(id);
    if (defect === undefined) throw new UnknownDefectError(id);
    if (defect.status === status) return this.#listed(defect);
    const at = this.#now().toISOString();
    const { fixedAt: _fixed, closedAt: _closed, ...kept } = defect;
    const moved: Defect =
      status === "open"
        ? { ...kept, status }
        : status === "fixed"
          ? { ...kept, status, fixedAt: at }
          : { ...kept, status, ...(defect.fixedAt === undefined ? {} : { fixedAt: defect.fixedAt }), closedAt: at };
    await this.#store.set(moved);
    return this.#listed(moved);
  }

  /** A defect with where it stands: a defect fixed whose test passed in an execution after the fix is replayed. */
  async #listed(defect: Defect): Promise<ListedDefect> {
    return { ...defect, stage: await this.#stage(defect) };
  }

  async #stage({ status, fixedAt, test }: Defect): Promise<DefectStage> {
    if (status !== "fixed") return status;
    const ran = await this.#executions.ofFile(test.path, READ_EXECUTIONS);
    const replayed = ran.some(({ ranAt, result }) => result.title === test.title && result.verdict === "passed" && ranAt > fixedAt!);
    return replayed ? "replayed" : "to_replay";
  }
}
