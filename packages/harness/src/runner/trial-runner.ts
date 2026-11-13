import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative } from "node:path";
import type { ProposedTest, ReportedTest, TestReference, TestRunner, TestTrial, TriedTest } from "@open-qa-stack/domain";
import { PinnedRun, type PinnedRunOptions } from "./pinned-run.ts";

/** Folder of the trials, in the state folder of the test repository. */
export const TRIALS_FOLDER = "trials";

/** The colours the runner writes in its messages. */
const COLOURS = /\u001b\[[0-9;]*m/g;

/**
 * Tries the test files a designer writes, one at a time, with the real runner on the machine.
 *
 * @remarks
 * The run is prepared once, at the first trial: the dependencies, then the browsers of the locked version.
 * Each file is written at its path for the time of its run, then removed, so that nothing is left in the
 * tracked files; its report and its traces stay in its folder of `<stateDir>/trials/`. The trials run one at
 * a time. The references a visual comparison lacks are made at the first run, then the file runs again
 * against them; they are given with the trial, to be kept with the test, and removed from the folder. The verdicts are those of `PinnedRun`, with, for a test that did not pass, every error of its
 * last attempt, the step that failed and its trace.
 */
export class TrialRunner implements TestRunner {
  private readonly options: Omit<PinnedRunOptions, "tests">;
  private readonly pinned: PinnedRun;
  private count = 0;
  /** The trials run one at a time: two never share a file, nor the runner. */
  private queue: Promise<unknown> = Promise.resolve();

  /** @param options - What a run needs, but the files: they are given at each trial. */
  public constructor(options: Omit<PinnedRunOptions, "tests">) {
    this.options = options;
    this.pinned = new PinnedRun({ ...options, tests: [] });
  }

  /** {@inheritDoc @open-qa-stack/domain#TestRunner.run} */
  public run(test: ProposedTest): Promise<TestTrial> {
    const next = this.queue.then(() => this.runAlone(test));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async runAlone(test: ProposedTest): Promise<TestTrial> {
    const { config, repositoryRoot } = this.options;
    const startedAt = (this.options.now ?? (() => new Date()))().toISOString();
    const file = join(repositoryRoot, test.path);
    if (existsSync(file)) return { startedAt, tests: [], error: `${test.path} already exists in the test repository; give the test another file name.` };
    const prepared = await this.pinned.prepare();
    if (!prepared.ok) return { startedAt, tests: [], error: prepared.reason };
    this.count += 1;
    const runDir = posix.join(config.repository.stateDir, TRIALS_FOLDER, `trial-${startedAt.replace(/[:.]/g, "-")}-${this.count}`);
    // The references of the visual comparisons of a test go next to it, as the runner names them.
    const snapshots = `${file}-snapshots`;
    const hadSnapshots = existsSync(snapshots);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, test.content);
    try {
      const first = await this.pinned.runFiles([test.path], runDir, ["--update-snapshots=missing"]);
      const references = hadSnapshots ? [] : await referencesIn(snapshots, repositoryRoot);
      // A run that made references compared the page with itself: the file runs again, against them.
      const ran = references.length === 0 ? first : await this.pinned.runFiles([test.path], `${runDir}-against-references`);
      const byId = new Map((ran.reported ?? []).map((reported) => [reported.id, reported]));
      const tests = ran.tests.map((verdict) => tried(verdict, byId.get(verdict.id), repositoryRoot));
      return { startedAt, tests, ...(references.length === 0 ? {} : { references }) };
    } finally {
      await rm(file, { force: true });
      if (!hadSnapshots) await rm(snapshots, { recursive: true, force: true });
    }
  }
}

/** A verdict, with the whole error, the failed step and the trace of the last attempt of a test that did not pass. */
function tried(verdict: Pick<TriedTest, "id" | "verdict" | "reason">, reported: ReportedTest | undefined, root: string): TriedTest {
  const attempt = reported?.attempts.at(-1);
  if (verdict.verdict === "passed" || attempt === undefined) return verdict;
  const error = attempt.errors.length === 0 ? undefined : attempt.errors.map((message) => message.replace(COLOURS, "")).join("\n\n");
  // The runner writes the trace with an absolute path.
  const trace = attempt.trace === undefined ? undefined : relative(root, attempt.trace);
  return {
    ...verdict,
    ...(error === undefined ? {} : { reason: error }),
    ...(attempt.failedStep === undefined ? {} : { failedStep: attempt.failedStep }),
    ...(trace === undefined ? {} : { trace }),
  };
}

/** The files of a folder of references, however deep, by their path relative to the test repository. */
async function referencesIn(folder: string, root: string): Promise<TestReference[]> {
  if (!existsSync(folder)) return [];
  const names = await readdir(folder, { recursive: true, withFileTypes: true });
  const files = names.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
  return Promise.all(files.sort().map(async (path) => ({ path: relative(root, path).split("\\").join("/"), content: new Uint8Array(await readFile(path)) })));
}
