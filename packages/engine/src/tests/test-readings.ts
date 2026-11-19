import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import {
  DEFAULT_REPOSITORY,
  qaViews,
  reportEntries,
  RUNS_FOLDER,
  UnknownCaptureError,
  type ConfigurationQueries,
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
  readonly report: string;
  /** The identifier the reader of the report gives the test. */
  readonly id: string;
  readonly test: JsonTest;
}

/**
 * The operations that read a test of the repository in steps, from the latest run that ran it: its steps, where it
 * failed, what its failed assertion expected and received, and the capture of each step. Whatever shows them — a REST
 * API, a terminal — calls these and holds no rule of its own.
 *
 * @remarks
 * The runs are the folders `<stateDir>/runs/run-<date>/` of the test repository, each with the report the runner
 * wrote; the latest one whose report holds the test counts. Nothing is kept: the reports are read at each call.
 */
export class TestReadings {
  readonly #repository: string | undefined;
  readonly #configuration: ConfigurationQueries;

  /**
   * @param repository - Absolute path of the test repository; `undefined` for a host that has none, which reads none.
   * @param configuration - What tells the revision in force of the configuration, which names its folders.
   */
  constructor(repository: string | undefined, configuration: ConfigurationQueries) {
    this.#repository = repository;
    this.#configuration = configuration;
  }

  /**
   * @param path - The path of a test, relative to the root of the test repository.
   * @returns The test in steps, from the latest run that ran it; without a view when no run kept ran it.
   */
  async read(path: string): Promise<TestReading> {
    const found = await this.#latest(path);
    if (found === undefined) return { path };
    // The report held the test: the reader reads it, and gives it the same identifier.
    const read = qaViews(found.report) as { readonly views: readonly QaView[] };
    return { path, run: found.run, view: read.views.find((candidate) => candidate.id === found.id)! };
  }

  /**
   * @param path - The path of a test, relative to the root of the test repository.
   * @param step - The number of one of its steps, from 1.
   * @returns The capture the latest run of the test attached for the step.
   * @throws `UnknownCaptureError` when no run ran the test, or it attached no capture for the step that can be read.
   */
  async capture(path: string, step: number): Promise<StepCapture> {
    const found = await this.#latest(path);
    const attachment = found?.test.results.at(-1)?.attachments?.find((candidate) => candidate.name === String(step)) as
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

  /** The latest run whose report holds the test of a path, with the test as that run reported it. */
  async #latest(path: string): Promise<RunTest | undefined> {
    const revision = await this.#configuration.inForce();
    if (this.#repository === undefined || revision === undefined) return undefined;
    const { appsDir, stateDir } = { ...DEFAULT_REPOSITORY, ...revision.document.repository };
    if (!path.startsWith(`${appsDir}/`)) return undefined;
    const file = path.slice(appsDir.length + 1);
    const runs = join(this.#repository, stateDir, RUNS_FOLDER);
    const folders = await readdir(runs, { withFileTypes: true }).catch(() => []);
    // The folders are named after the date of their run: the latest comes first in reverse order.
    for (const run of folders
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left))) {
      const report = await readFile(join(runs, run, REPORT_FILE), "utf8").catch(() => "");
      const entry = reportEntries(report)?.find((candidate) => candidate.file === file);
      if (entry !== undefined) return { run, report, id: entry.id, test: entry.test };
    }
    return undefined;
  }

  /** Whether a file the runner wrote is inside the test repository. */
  #within(file: string): boolean {
    const inside = relative(this.#repository!, file);
    return isAbsolute(file) && inside !== "" && !inside.startsWith("..") && !isAbsolute(inside);
  }
}
