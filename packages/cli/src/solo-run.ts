import { readFile, writeFile } from "node:fs/promises";
import { join, posix, relative } from "node:path";
import type { CommandRunner, TestVerdict } from "@open-qa-stack/domain";
import { Cartographer, Designer, type JournalEntry } from "@open-qa-stack/agents";
import { CharterCheck, designerInstructions, LocalRunner, PinnedRun, resolveCharter, RUNS_FOLDER, TrialRunner, type ActiveRule } from "@open-qa-stack/harness";
import { CONFIG_FILE_NAME, declaredValues, validateConfig, type ResolvedConfig } from "@open-qa-stack/shared";
import { ExitCode, exitCodeOf, type ExitCodeValue } from "./exit-code.ts";
import type { OpenRuntime } from "./live-runtime.ts";
import { missingPrerequisites } from "./prerequisites.ts";
import { RunJournal, type Step } from "./run-journal.ts";

/** What a run of the solo command needs. */
export interface SoloRunOptions {
  /** Absolute path of the test repository. */
  readonly repositoryRoot: string;
  /** The environment to run against; the only one declared by default. */
  readonly environment?: string;
  /** Maps every source again, even those whose card is up to date. */
  readonly force?: boolean;
  /** The environment of the process: the secrets and the accounts the configuration names. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Receives the journal, a line at a time: the error output. */
  readonly write: (line: string) => void;
  /** Receives the summary: the standard output. */
  readonly print: (line: string) => void;
  /** Opens the runtime of the agents on the model of the configuration. */
  readonly openRuntime: (config: ResolvedConfig) => Promise<OpenRuntime>;
  /** Runs the commands of the machine and of the tests; a `LocalRunner` in the test repository by default. */
  readonly runner?: CommandRunner;
  /** The clock; the system clock by default. */
  readonly now?: () => Date;
}

/** The state of a run, written to `<stateDir>/runs/oqas-<date>.json`. */
export interface SoloRunState {
  readonly formatVersion: 1;
  /** Identifier of the run: `oqas-` and its date. */
  readonly runId: string;
  readonly environment: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly exitCode: ExitCodeValue;
  /** Each step that ran, with how long it took and how many requests it sent to the model. */
  readonly steps: readonly { readonly step: Step; readonly durationMs: number; readonly modelRequests: number }[];
  /** The domain index, relative to the test repository, when it was written. */
  readonly index?: string;
  /** The local branch the tests were written on, when they were. */
  readonly branch?: string;
  /** The test files designed, relative to the test repository. */
  readonly designed: readonly string[];
  /** The result of the run of the tests, and its raw report, relative to the test repository, when they ran. */
  readonly run?: string;
  readonly report?: string;
  /** The verdict of each test, as the harness pronounced it. */
  readonly tests: readonly TestVerdict[];
  /** The journal of the run, relative to the test repository. */
  readonly journal: string;
}

/**
 * A run of the solo command: it reads the configuration, checks the machine, maps the target, designs tests
 * on a new local branch, runs them, and writes a summary.
 *
 * @remarks
 * Each step starts only when the one before succeeded. A missing or invalid configuration stops the run
 * before anything else, with nothing written to the test repository. Nothing is pushed, and the git
 * configuration of the repository is left as it is. The journal goes to the error output and to a JSON
 * Lines file of the run; the summary goes to the standard output; every declared secret is masked.
 */
export class SoloRun {
  private readonly options: SoloRunOptions;

  /** @param options - What the run needs. */
  public constructor(options: SoloRunOptions) {
    this.options = options;
  }

  /**
   * Runs the command.
   *
   * @returns The exit code.
   * @throws Error when a file cannot be written, or git refuses the branch.
   */
  public async run(): Promise<ExitCodeValue> {
    const now = this.options.now ?? (() => new Date());
    const started = now();
    const early = new RunJournal({ write: this.options.write, now }, []);
    const loaded = await this.configuration(early);
    if (typeof loaded === "number") return loaded;
    const { config, environment, rules } = loaded;
    const journal = new RunJournal({ write: this.options.write, now }, declaredValues(config, this.options.env));
    journal.adopt(early.entries);
    const runId = `oqas-${started.toISOString().replace(/[:.]/g, "-")}`;
    const runsDir = posix.join(config.repository.stateDir, RUNS_FOLDER);
    const steps: { step: Step; durationMs: number; modelRequests: number }[] = [];
    const timed = async <T>(step: Step, body: () => Promise<{ value: T; ok: boolean; modelRequests: number }>): Promise<{ value: T; ok: boolean }> => {
      const at = now().getTime();
      journal.record(step, "started", `The ${step} starts.`);
      const done = await body();
      const durationMs = now().getTime() - at;
      steps.push({ step, durationMs, modelRequests: done.modelRequests });
      journal.record(step, "finished", done.ok ? `The ${step} succeeded.` : `The ${step} did not succeed.`, { durationMs, modelRequests: done.modelRequests });
      return done;
    };
    const runner = this.options.runner ?? new LocalRunner(this.options.repositoryRoot);
    const prerequisites = await timed("prerequisites", async () => {
      const missing = await missingPrerequisites(config, this.options.repositoryRoot, runner);
      for (const problem of missing) journal.record("prerequisites", "error", problem);
      return { value: missing, ok: missing.length === 0, modelRequests: 0 };
    });
    if (!prerequisites.ok) return ExitCode.prerequisite;
    journal.keepIn(join(this.options.repositoryRoot, runsDir, `${runId}.jsonl`));
    const state = { formatVersion: 1 as const, runId, environment, startedAt: started.toISOString(), designed: [] as string[], tests: [] as TestVerdict[], journal: posix.join(runsDir, `${runId}.jsonl`) };
    const finish = async (exitCode: ExitCodeValue, found: Partial<SoloRunState>): Promise<ExitCodeValue> => {
      const written: SoloRunState = { ...state, ...found, exitCode, steps, durationMs: now().getTime() - started.getTime() };
      await timed("summary", async () => {
        await writeFile(join(this.options.repositoryRoot, runsDir, `${runId}.json`), `${JSON.stringify(written, null, 2)}\n`);
        this.summarize(written);
        return { value: undefined, ok: true, modelRequests: 0 };
      });
      return exitCode;
    };
    const open = await this.options.openRuntime(config);
    try {
      const mapped = await timed("cartography", async () => {
        const outcome = await new Cartographer({ config, environment, repositoryRoot: this.options.repositoryRoot, env: this.options.env, runtime: open.runtime, concurrency: config.cartography.concurrency, ...(this.options.force === true ? { force: true } : {}) }).run();
        this.relay(journal, "cartography", outcome.journal);
        return { value: outcome, ok: outcome.index !== undefined, modelRequests: outcome.index?.run.iterations ?? 0 };
      });
      if (!mapped.ok) return await finish(ExitCode.interrupted, {});
      const index = relative(this.options.repositoryRoot, mapped.value.indexPath!);
      const trials = new TrialRunner({ config, environment, repositoryRoot: this.options.repositoryRoot, runner, env: this.options.env });
      const designed = await timed("design", async () => {
        // The tests are checked against the dependencies of the test repository: they are installed first.
        const prepared = await trials.prepare();
        if (!prepared.ok) {
          journal.record("design", "error", prepared.reason);
          return { value: { ok: false, tests: [], journal: [] } as Awaited<ReturnType<Designer["run"]>>, ok: false, modelRequests: 0 };
        }
        const outcome = await new Designer({
          config,
          repositoryRoot: this.options.repositoryRoot,
          env: this.options.env,
          runtime: open.runtime,
          instructions: designerInstructions(rules, config.repository),
          check: new CharterCheck({ repository: this.options.repositoryRoot, rules }),
          runner: trials,
        }).run();
        this.relay(journal, "design", outcome.journal);
        const iterations = outcome.statePath === undefined ? 0 : await designIterations(outcome.statePath);
        return { value: outcome, ok: outcome.ok, modelRequests: iterations };
      });
      const tests = designed.value.tests.map((test) => test.path);
      const branch = designed.value.branch === undefined ? {} : { branch: designed.value.branch };
      if (!designed.ok) return await finish(ExitCode.interrupted, { index, ...branch, designed: tests });
      const executed = await timed("execution", async () => {
        const outcome = await new PinnedRun({ config, environment, repositoryRoot: this.options.repositoryRoot, tests, runner, env: this.options.env }).run();
        for (const test of outcome.result.tests) journal.record("execution", test.verdict === "passed" ? "info" : "error", `${test.verdict}: ${test.id}. ${test.verdict === "passed" ? "" : test.reason}`.trim());
        return { value: outcome, ok: true, modelRequests: 0 };
      });
      const { result, resultPath } = executed.value;
      const run = relative(this.options.repositoryRoot, resultPath);
      return await finish(exitCodeOf(result.tests.map((test) => test.verdict)), { index, ...branch, designed: tests, run, ...(result.report === undefined ? {} : { report: result.report }), tests: result.tests });
    } finally {
      await open.close();
    }
  }

  /** The configuration, the environment and the rules of the charter, or the exit code when they cannot be had. */
  private async configuration(journal: RunJournal): Promise<{ config: ResolvedConfig; environment: string; rules: ActiveRule[] } | ExitCodeValue> {
    journal.record("configuration", "started", "The configuration starts.");
    const path = join(this.options.repositoryRoot, CONFIG_FILE_NAME);
    const text = await readFile(path, "utf8").catch(() => undefined);
    if (text === undefined) {
      journal.record("configuration", "error", `${path} cannot be read; the solo command needs a ${CONFIG_FILE_NAME} at the root of the test repository.`);
      return ExitCode.configuration;
    }
    const result = validateConfig(text, this.options.env);
    if (!result.ok) {
      for (const error of result.errors) journal.record("configuration", "error", `${error.path || "/"}: ${error.message}`);
      return ExitCode.configuration;
    }
    const declared = [...new Set(result.config.applications.flatMap((application) => application.environments.map((environment) => environment.name)))];
    const environment = this.options.environment ?? (declared.length === 1 ? declared[0] : undefined);
    if (environment === undefined) {
      journal.record("configuration", "error", `Several environments are declared (${declared.join(", ")}); name one with --environment.`);
      return ExitCode.configuration;
    }
    if (!declared.includes(environment)) {
      journal.record("configuration", "error", `The environment ${environment} is not declared; the configuration declares ${declared.join(", ")}.`);
      return ExitCode.configuration;
    }
    const charter = resolveCharter(result.config.charter);
    if (!charter.ok) {
      for (const error of charter.errors) journal.record("configuration", "error", `${error.path}: ${error.message}`);
      return ExitCode.configuration;
    }
    journal.record("configuration", "finished", `The configuration is valid; the run targets the environment ${environment}.`);
    return { config: result.config, environment, rules: charter.rules };
  }

  /** Writes the entries of the journal of a role to the journal of the run. */
  private relay(journal: RunJournal, step: Step, entries: readonly JournalEntry[]): void {
    for (const entry of entries) journal.record(step, entry.level, entry.source === undefined ? entry.message : `${entry.source}: ${entry.message}`);
  }

  /** Prints the summary of a run. */
  private summarize(state: SoloRunState): void {
    const lines = [
      `Run ${state.runId}: exit code ${state.exitCode}.`,
      ...(state.branch === undefined ? [] : [`Tests written on the branch ${state.branch}.`]),
      ...state.tests.map((test) => `${test.verdict.padEnd(13)} ${test.id}`),
      `State: ${posix.join(posix.dirname(state.journal), `${state.runId}.json`)}`,
    ];
    for (const line of lines) this.options.print(`${line}\n`);
  }
}

/** The iterations of a design, as its state gives them. */
async function designIterations(statePath: string): Promise<number> {
  const state = JSON.parse(await readFile(statePath, "utf8")) as { run: { iterations: number } };
  return state.run.iterations;
}
