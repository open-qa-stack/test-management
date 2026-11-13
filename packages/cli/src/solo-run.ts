import { readFile, writeFile } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import type { CommandRunner, TestVerdict } from "@open-qa-stack/domain";
import { Cartographer, Designer, type JournalEntry } from "@open-qa-stack/agents";
import { CharterCheck, designerInstructions, LocalRunner, PinnedRun, resolveCharter, RUNS_FOLDER, TrialRunner, type ActiveRule } from "@open-qa-stack/harness";
import { CONFIG_FILE_NAME, declaredValues, validateConfig, type ResolvedConfig } from "@open-qa-stack/shared";
import { ExitCode, exitCodeOf, type ExitCodeValue } from "./exit-code.ts";
import type { OpenRuntime } from "./live-runtime.ts";
import { missingPrerequisites } from "./prerequisites.ts";
import { CountedRuntime } from "./counted-runtime.ts";
import { RunJournal, type Step } from "./run-journal.ts";

/** The rule of the charter that ends each step of a test with a screenshot, which the skeleton of a test then holds. */
const SCREENSHOT_RULE = "PW-SHOT-01";

/** What a run of the solo command needs. */
export interface SoloRunOptions {
  /** Absolute path of the test repository. */
  readonly repositoryRoot: string;
  /** The environment to run against; the only one declared by default. */
  readonly environment?: string;
  /** Maps every source again, even those whose card is up to date. */
  readonly force?: boolean;
  /** What to test, in the developer's words; the designer works on the whole domain index without it. */
  readonly brief?: string;
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
  /** Version of the format of the state. */
  readonly formatVersion: 1;
  /** Identifier of the run: `oqas-` and its date. */
  readonly runId: string;
  /** The environment the run targeted. */
  readonly environment: string;
  /** When the run started, as an ISO 8601 date. */
  readonly startedAt: string;
  /** How long the run took, in milliseconds, up to the start of the summary. */
  readonly durationMs: number;
  /** The exit code of the command. */
  readonly exitCode: ExitCodeValue;
  /** Each step that ran, with how long it took and how many requests it sent to the model. */
  readonly steps: readonly { readonly step: Step; readonly durationMs: number; readonly modelRequests: number }[];
  /** The domain index, relative to the test repository, when it was written. */
  readonly index?: string;
  /** The local branch the tests were written on, when they were. */
  readonly branch?: string;
  /** The test files designed, relative to the test repository. */
  readonly designed: readonly string[];
  /** The result of the run of the tests, relative to the test repository, when they ran. */
  readonly run?: string;
  /** The raw report of the runner, relative to the test repository, when the tests ran. */
  readonly report?: string;
  /** The verdict of each test, as the harness pronounced it, every secret masked in its reason. */
  readonly tests: readonly TestVerdict[];
  /** The journal of the run, relative to the test repository. */
  readonly journal: string;
}

/**
 * A run of the solo command: it reads the configuration, checks the machine, maps the target, designs tests
 * on a new local branch, runs them, and writes a summary.
 *
 * @remarks
 * Each step starts only when the one before succeeded; once the prerequisites passed, the summary closes the
 * runtime of the agents and writes the state whatever the end of the others. A missing or invalid configuration stops the run
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
   * @returns The exit code; `5` when a step stopped on an unexpected error, which the journal tells.
   * @throws Error when the journal or the state of the run cannot be written, or an output refuses a line.
   */
  public async run(): Promise<ExitCodeValue> {
    const now = this.options.now ?? (() => new Date());
    const started = now();
    const early = new RunJournal({ write: this.options.write, now }, []);
    const loaded = await this.configuration(early, now);
    if (typeof loaded === "number") return loaded;
    const { config, environment, rules } = loaded;
    const journal = new RunJournal({ write: this.options.write, now }, declaredValues(config, this.options.env));
    journal.adopt(early.entries);
    const runId = `oqas-${started.toISOString().replace(/[:.]/g, "-")}`;
    const runsDir = posix.join(config.repository.stateDir, RUNS_FOLDER);
    const steps: { step: Step; durationMs: number; modelRequests: number }[] = [{ step: "configuration", durationMs: loaded.durationMs, modelRequests: 0 }];
    // The requests of a step are those its sessions sent to the model, whatever its end.
    let counted: CountedRuntime | undefined;
    const requests = (): number => counted?.modelRequests ?? 0;
    const timed = async <T>(step: Step, body: () => Promise<{ value: T; ok: boolean }>): Promise<{ value: T; ok: boolean }> => {
      const at = now().getTime();
      const before = requests();
      const close = (ok: boolean): void => {
        const durationMs = now().getTime() - at;
        const modelRequests = requests() - before;
        steps.push({ step, durationMs, modelRequests });
        journal.record(step, "finished", ok ? `The ${step} succeeded.` : `The ${step} did not succeed.`, { durationMs, modelRequests });
      };
      try {
        journal.record(step, "started", `The ${step} starts.`);
        const done = await body();
        close(done.ok);
        return done;
      } catch (error) {
        journal.record(step, "error", `The ${step} stopped on an unexpected error: ${messageOf(error)}`);
        close(false);
        throw error;
      }
    };
    const runner = this.options.runner ?? new LocalRunner(this.options.repositoryRoot);
    const prerequisites = await timed("prerequisites", async () => {
      const missing = await missingPrerequisites(config, this.options.repositoryRoot, runner);
      for (const problem of missing) journal.record("prerequisites", "error", problem);
      return { value: missing, ok: missing.length === 0 };
    });
    if (!prerequisites.ok) return ExitCode.prerequisite;
    journal.keepIn(join(this.options.repositoryRoot, runsDir, `${runId}.jsonl`));
    const state = {
      formatVersion: 1 as const,
      runId,
      environment,
      startedAt: started.toISOString(),
      designed: [] as string[],
      tests: [] as TestVerdict[],
      journal: posix.join(runsDir, `${runId}.jsonl`),
    };
    let found: Partial<SoloRunState> = {};
    let open: OpenRuntime | undefined;
    const finish = async (exitCode: ExitCodeValue): Promise<ExitCodeValue> => {
      const written: SoloRunState = { ...state, ...found, exitCode, steps, durationMs: now().getTime() - started.getTime() };
      await timed("summary", async () => {
        // A runtime that cannot be closed is told, and the state is written all the same.
        await open?.close().catch((error: unknown) => journal.record("summary", "error", `The runtime of the agents could not be closed: ${messageOf(error)}`));
        await writeFile(join(this.options.repositoryRoot, runsDir, `${runId}.json`), `${JSON.stringify(written, null, 2)}\n`);
        this.summarize(written);
        return { value: undefined, ok: true };
      });
      return exitCode;
    };
    const chain = async (): Promise<ExitCodeValue> => {
      const mapped = await timed("cartography", async () => {
        // The runtime of the agents is opened by the first step that calls the model.
        open = await this.options.openRuntime(config);
        counted = new CountedRuntime(open.runtime);
        const outcome = await new Cartographer({
          config,
          environment,
          repositoryRoot: this.options.repositoryRoot,
          env: this.options.env,
          runtime: counted,
          concurrency: config.cartography.concurrency,
          ...(this.options.force === true ? { force: true } : {}),
        }).run();
        this.relay(journal, "cartography", outcome.journal);
        return { value: outcome, ok: outcome.index !== undefined };
      });
      if (!mapped.ok) return ExitCode.interrupted;
      found = { index: this.inRepository(mapped.value.indexPath!) };
      const trials = new TrialRunner({ config, environment, repositoryRoot: this.options.repositoryRoot, runner, env: this.options.env });
      const designed = await timed("design", async () => {
        // The tests are checked against the dependencies of the test repository: they are installed first.
        const prepared = await trials.prepare();
        if (!prepared.ok) {
          journal.record("design", "error", prepared.reason);
          return { value: { ok: false, tests: [], journal: [] } as Awaited<ReturnType<Designer["run"]>>, ok: false };
        }
        const outcome = await new Designer({
          config,
          repositoryRoot: this.options.repositoryRoot,
          env: this.options.env,
          runtime: counted!,
          instructions: designerInstructions(rules, config.repository),
          check: new CharterCheck({ repository: this.options.repositoryRoot, rules }),
          screenshots: rules.some((rule) => rule.id === SCREENSHOT_RULE),
          runner: trials,
          ...(this.options.brief === undefined ? {} : { brief: this.options.brief }),
        }).run();
        this.relay(journal, "design", outcome.journal);
        return { value: outcome, ok: outcome.ok };
      });
      const tests = designed.value.tests.map((test) => test.path);
      found = { ...found, ...(designed.value.branch === undefined ? {} : { branch: designed.value.branch }), designed: tests };
      if (!designed.ok) return ExitCode.interrupted;
      const executed = await timed("execution", async () => {
        // The dependencies the design installed serve the execution as well.
        const outcome = await new PinnedRun({
          config,
          environment,
          repositoryRoot: this.options.repositoryRoot,
          tests,
          runner,
          env: this.options.env,
          preparation: trials.prepare(),
        }).run();
        for (const test of outcome.result.tests)
          journal.record(
            "execution",
            test.verdict === "passed" ? "info" : "error",
            `${test.verdict}: ${test.id}. ${test.verdict === "passed" ? "" : test.reason}`.trim(),
          );
        return { value: outcome, ok: true };
      });
      const { result, resultPath } = executed.value;
      found = {
        ...found,
        run: this.inRepository(resultPath),
        ...(result.report === undefined ? {} : { report: result.report }),
        tests: result.tests.map((test) => ({ ...test, reason: journal.mask(test.reason) })),
      };
      return exitCodeOf(result.tests.map((test) => test.verdict));
    };
    let exitCode: ExitCodeValue;
    try {
      exitCode = await chain();
    } catch {
      // The step that stopped told why in the journal; the state keeps what the steps before produced.
      exitCode = ExitCode.interrupted;
    }
    return await finish(exitCode);
  }

  /** A path of the test repository, relative to it and with forward slashes, as the state keeps it. */
  private inRepository(path: string): string {
    return relative(this.options.repositoryRoot, path).split(sep).join(posix.sep);
  }

  /** The configuration, the environment and the rules of the charter, or the exit code when they cannot be had. */
  private async configuration(
    journal: RunJournal,
    now: () => Date,
  ): Promise<{ config: ResolvedConfig; environment: string; rules: ActiveRule[]; durationMs: number } | ExitCodeValue> {
    const at = now().getTime();
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
    const durationMs = now().getTime() - at;
    journal.record("configuration", "finished", `The configuration is valid; the run targets the environment ${environment}.`, {
      durationMs,
      modelRequests: 0,
    });
    return { config: result.config, environment, rules: charter.rules, durationMs };
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

/** The message of an error, or the value thrown. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
