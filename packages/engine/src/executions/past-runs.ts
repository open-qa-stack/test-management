import { readdir, readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { DEFAULT_REPOSITORY, executionResults, RUNS_FOLDER, type ConfigurationQueries, type ExecutionStorePort } from "@open-qa-stack/domain";

/** The name of the report a run writes in its folder, the JSON of the Playwright reporter. */
const REPORT_FILE = "report.json";

/** The folder of a run, named after the date it started at: `run-2026-11-19T00-29-03-488Z`. */
const RUN_FOLDER = /^run-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/;

/**
 * Takes into the store of the executions the runs of the test repository that ran before the instance kept them:
 * the folders `<stateDir>/runs/run-<date>/` whose report the store does not hold yet.
 *
 * @remarks
 * Such an execution comes from a session of design, which is not known any more; it is dated by the start of its
 * run, and keeps no version: the commit and the files of then are gone.
 */
export class PastRuns {
  readonly #repository: string | undefined;
  readonly #configuration: ConfigurationQueries;
  readonly #store: ExecutionStorePort;

  /**
   * @param repository - Absolute path of the test repository; `undefined` for a host that has none, which takes none.
   * @param configuration - What tells the revision in force of the configuration, which names its folders.
   * @param store - Where the executions are kept.
   */
  constructor(repository: string | undefined, configuration: ConfigurationQueries, store: ExecutionStorePort) {
    this.#repository = repository;
    this.#configuration = configuration;
    this.#store = store;
  }

  /**
   * Keeps each run whose report the store does not hold, the earliest first.
   *
   * @returns How many runs were taken.
   * @throws When the store cannot be read, or refuses an execution.
   */
  async take(): Promise<number> {
    const revision = await this.#configuration.inForce();
    if (this.#repository === undefined || revision === undefined) return 0;
    const { appsDir, stateDir } = { ...DEFAULT_REPOSITORY, ...revision.document.repository };
    const kept = new Set((await this.#store.list()).map(({ report }) => report));
    const folders = await readdir(join(this.#repository, stateDir, RUNS_FOLDER), { withFileTypes: true }).catch(() => []);
    let taken = 0;
    for (const name of folders
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))) {
      const date = RUN_FOLDER.exec(name);
      const report = posix.join(stateDir, RUNS_FOLDER, name, REPORT_FILE);
      if (date === null || kept.has(report)) continue;
      const results = executionResults(await readFile(join(this.#repository, report), "utf8").catch(() => ""), appsDir);
      if (results === undefined) continue;
      const [, day, hours, minutes, seconds, milliseconds] = date;
      await this.#store.add({ id: name, origin: "design", ranAt: `${day}T${hours}:${minutes}:${seconds}.${milliseconds}Z`, report, results });
      taken += 1;
    }
    return taken;
  }
}
