import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import {
  DEFAULT_REPOSITORY,
  qaViews,
  reportEntries,
  runFolderDate,
  RUNS_FOLDER,
  UnknownCaptureError,
  UnknownExecutionError,
  type ConfigurationQueries,
  type ExecutionStorePort,
  type JsonTest,
  type QaView,
  type TestReading,
} from "@open-qa-stack/domain";

/** The name of the report a run writes in its folder, the JSON of the Playwright reporter. */
const REPORT_FILE = "report.json";

/** A capture of a step, as a person's browser shows it. */
export interface StepCapture {
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

/** The test of a run, with the folder of that run. */
interface RunTest {
  readonly run: string;
  /** When the run ran, when it is known. */
  readonly ranAt?: string;
  readonly report: string;
  /** The identifier the reader of the report gives the test. */
  readonly id: string;
  readonly test: JsonTest;
}

/** The test of a run in steps, as the reader of its report gives it, under the same identifier. */
function viewOf(found: RunTest): QaView {
  const read = qaViews(found.report) as { readonly views: readonly QaView[] };
  return read.views.find((candidate) => candidate.id === found.id)!;
}

/**
 * The operations that read a test of the repository in steps, from the latest run that ran it or from an execution
 * the instance keeps: its steps, where it failed, what its failed assertion expected and received, and the capture of
 * each step. Whatever shows them — a REST API, a terminal — calls these and holds no rule of its own.
 *
 * @remarks
 * The runs are the folders `<stateDir>/runs/run-<date>/` of the test repository, each with the report the runner
 * wrote; the latest one whose report holds the test counts, unless an execution is named, whose report counts.
 * Nothing is kept: the reports are read at each call.
 */
export class TestReadings {
  readonly #repository: string | undefined;
  readonly #configuration: ConfigurationQueries;
  readonly #executions: ExecutionStorePort;

  /**
   * @param repository - Absolute path of the test repository; `undefined` for a host that has none, which reads none.
   * @param configuration - What tells the revision in force of the configuration, which names its folders.
   * @param executions - Where the executions are kept, whose reports name their runs.
   */
  constructor(repository: string | undefined, configuration: ConfigurationQueries, executions: ExecutionStorePort) {
    this.#repository = repository;
    this.#configuration = configuration;
    this.#executions = executions;
  }

  /**
   * @param path - The path of a test, relative to the root of the test repository.
   * @param execution - The identifier of an execution to read the test from; the latest run that ran it when left out.
   * @returns The test in steps; without a view when no run kept ran it, or the report of the execution is gone or did not hold it.
   * @throws `UnknownExecutionError` when the instance keeps no execution under the identifier.
   */
  async read(path: string, execution?: string): Promise<TestReading> {
    const found = await this.#find(path, execution);
    if (found === undefined) return { path };
    // The report held the test: the reader reads it, and gives it the same identifier.
    return { path, run: found.run, ...(found.ranAt === undefined ? {} : { ranAt: found.ranAt }), view: viewOf(found) };
  }

  /**
   * @param path - The path of a test, relative to the root of the test repository.
   * @param step - The number of one of its steps, from 1.
   * @param execution - The identifier of an execution to read the capture from; the latest run that ran the test when left out.
   * @returns The capture the run of the test attached for the step.
   * @throws `UnknownExecutionError` when the instance keeps no execution under the identifier; `UnknownCaptureError`
   * when no run ran the test, or it attached no capture for the step that can be read.
   */
  async capture(path: string, step: number, execution?: string): Promise<StepCapture> {
    const found = await this.#find(path, execution);
    // The capture of a step is the one its view shows: attached under its number, or taken by the runner at the failure.
    const name = found === undefined ? undefined : viewOf(found).steps.find((candidate) => candidate.number === step)?.capture?.name;
    const attachment = found?.test.results.at(-1)?.attachments?.find((candidate) => candidate.name === name) as
      { readonly contentType?: string; readonly body?: string; readonly path?: string } | undefined;
    const contentType = attachment?.contentType ?? "application/octet-stream";
    if (attachment?.body !== undefined) return { contentType, bytes: Buffer.from(attachment.body, "base64") };
    // A capture the runner wrote to a file is read only when the file is in the test repository.
    if (attachment?.path === undefined || !this.#within(attachment.path)) throw new UnknownCaptureError(path, step);
    try {
      return { contentType, bytes: await readFile(attachment.path) };
    } catch {
      throw new UnknownCaptureError(path, step);
    }
  }

  /** The run that ran the test of a path, that of an execution or the latest one, with the test as that run reported it. */
  async #find(path: string, execution: string | undefined): Promise<RunTest | undefined> {
    const kept = execution === undefined ? undefined : await this.#executions.get(execution);
    if (execution !== undefined && kept === undefined) throw new UnknownExecutionError(execution);
    const revision = await this.#configuration.inForce();
    if (this.#repository === undefined || revision === undefined) return undefined;
    const { appsDir, stateDir } = { ...DEFAULT_REPOSITORY, ...revision.document.repository };
    if (!path.startsWith(`${appsDir}/`)) return undefined;
    const file = path.slice(appsDir.length + 1);
    if (kept !== undefined) {
      const report = await readFile(join(this.#repository, kept.report), "utf8").catch(() => "");
      const entry = reportEntries(report)?.find((candidate) => candidate.file === file);
      return entry === undefined ? undefined : { run: basename(dirname(kept.report)), ranAt: kept.ranAt, report, id: entry.id, test: entry.test };
    }
    const runs = join(this.#repository, stateDir, RUNS_FOLDER);
    const folders = await readdir(runs, { withFileTypes: true }).catch(() => []);
    // The folders are named after the date of their run: the latest comes first in reverse order.
    for (const run of folders
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left))) {
      const report = await readFile(join(runs, run, REPORT_FILE), "utf8").catch(() => "");
      const entry = reportEntries(report)?.find((candidate) => candidate.file === file);
      const ranAt = runFolderDate(run);
      if (entry !== undefined) return { run, ...(ranAt === undefined ? {} : { ranAt }), report, id: entry.id, test: entry.test };
    }
    return undefined;
  }

  /** Whether a file the runner wrote is inside the test repository. */
  #within(file: string): boolean {
    const inside = relative(this.#repository!, file);
    return isAbsolute(file) && inside !== "" && !inside.startsWith("..") && !isAbsolute(inside);
  }
}
