import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative } from "node:path";
import type { ProposedTest, ReportedTest, TestRunner, TestTrial, TriedTest } from "@open-qa-stack/domain";
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
 * tracked files; its report and its traces stay in `<stateDir>/trials/`. The verdicts are those of
 * `PinnedRun`, with, for a test that did not pass, its whole error, the step that failed and its trace.
 */
export class TrialRunner implements TestRunner {
  private readonly options: Omit<PinnedRunOptions, "tests">;
  private readonly pinned: PinnedRun;
  private count = 0;

  /** @param options - What a run needs, but the files: they are given at each trial. */
  public constructor(options: Omit<PinnedRunOptions, "tests">) {
    this.options = options;
    this.pinned = new PinnedRun({ ...options, tests: [] });
  }

  /** {@inheritDoc @open-qa-stack/domain#TestRunner.run} */
  public async run(test: ProposedTest): Promise<TestTrial> {
    const { config, repositoryRoot } = this.options;
    const startedAt = (this.options.now ?? (() => new Date()))().toISOString();
    const file = join(repositoryRoot, test.path);
    if (existsSync(file)) return { startedAt, tests: [], error: `${test.path} already exists in the test repository; give the test another file name.` };
    const prepared = await this.pinned.prepare();
    if (!prepared.ok) return { startedAt, tests: [], error: prepared.reason };
    this.count += 1;
    const runDir = posix.join(config.repository.stateDir, TRIALS_FOLDER, `trial-${startedAt.replace(/[:.]/g, "-")}-${this.count}`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, test.content);
    try {
      const ran = await this.pinned.runFiles([test.path], runDir);
      const byId = new Map((ran.reported ?? []).map((reported) => [reported.id, reported]));
      return { startedAt, tests: ran.tests.map((verdict) => tried(verdict, byId.get(verdict.id), repositoryRoot)) };
    } finally {
      await rm(file, { force: true });
    }
  }
}

/** A verdict, with the whole error, the failed step and the trace of the last attempt of a test that did not pass. */
function tried(verdict: Pick<TriedTest, "id" | "verdict" | "reason">, reported: ReportedTest | undefined, root: string): TriedTest {
  const attempt = reported?.attempts.at(-1);
  if (verdict.verdict === "passed" || attempt === undefined) return verdict;
  const error = attempt.errors[0]?.replace(COLOURS, "");
  // The runner writes the trace with an absolute path.
  const trace = attempt.trace === undefined ? undefined : relative(root, attempt.trace);
  return {
    ...verdict,
    ...(error === undefined ? {} : { reason: error }),
    ...(attempt.failedStep === undefined ? {} : { failedStep: attempt.failedStep }),
    ...(trace === undefined ? {} : { trace }),
  };
}
