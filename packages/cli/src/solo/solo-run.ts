import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import type { CommandRunner, StopReason, TestVerdict, UncoveredRequest } from "@open-qa-stack/domain";
import { Cartographer, Designer, type JournalEntry, type TraceLine } from "@open-qa-stack/agents";
import { CharterCheck, writerInstructions, LocalRunner, PinnedRun, resolveCharter, RUNS_FOLDER, TrialRunner, type ActiveRule } from "@open-qa-stack/harness";
import { CONFIG_FILE_NAME, declaredValues, validateConfig, type ResolvedConfig } from "@open-qa-stack/shared";
import { ExitCode, exitCodeOf, type ExitCodeValue } from "./exit-code.ts";
import { runnableTests } from "./runnable-tests.ts";
import type { OpenRuntime } from "./live-runtime.ts";
import { missingPrerequisites } from "./prerequisites.ts";
import { CountedRuntime } from "./counted-runtime.ts";
import { GuardedRuntime } from "./guarded-runtime.ts";
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
  /** The identifier of a run a limit stopped: the run resumes it, in its environment, with its brief, from the step it stopped at. */
  readonly resume?: string;
  /** The environment of the process: the secrets and the accounts the configuration names. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Receives the journal, a line at a time: the error output. */
  readonly write: (line: string) => void;
  /** Receives each line of the trace of the agents as it is written, to follow the run; nothing follows it otherwise. */
  readonly follow?: (line: TraceLine) => void;
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
  /** The run this one resumes, when it resumes one. */
  readonly resumes?: string;
  /** The environment the run targeted. */
  readonly environment: string;
  /** What to test, in the developer's words, when it was given. */
  readonly brief?: string;
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
  /** What the brief asks and the plan leaves out, because the application does not allow it, each with why; left out when the plan covers the brief. */
  readonly uncovered?: readonly UncoveredRequest[];
  /** The design state, relative to the test repository, when the design wrote it. */
  readonly designState?: string;
  /** The step a limit of the autonomy stopped, and the limit, when one stopped the run: it can then be resumed. */
  readonly stoppedBy?: { readonly step: "cartography" | "design"; readonly limit: StopReason["limit"] };
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
 * Lines file of the run; the summary goes to the standard output; every declared secret is masked. The
 * guardrail of the autonomy, counted from the start of the run, stops every task of the agents.
 *
 * A run a limit stopped in its cartography or its design says how to resume it; a design cut short that gave
 * its tests still leads to their execution. Resumed, a run takes the environment and the brief of the one it
 * resumes, and starts again from the step that was stopped: the cartography keeps the cards it made, and the
 * design goes on from its plan and its tests, on its branch. A run is resumed once: then the run that resumed
 * it is to be resumed, if a limit stopped it.
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
    const { config, environment, rules, resumed } = loaded;
    const brief = resumed === undefined ? this.options.brief : resumed.brief;
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
      ...(resumed === undefined ? {} : { resumes: resumed.runId }),
      environment,
      ...(brief === undefined ? {} : { brief }),
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
        if (written.stoppedBy !== undefined) journal.record("summary", "info", resumeHint(written));
        // A runtime that cannot be closed is told, and the state is written all the same.
        await open?.close().catch((error: unknown) => journal.record("summary", "error", `The runtime of the agents could not be closed: ${messageOf(error)}`));
        await writeFile(join(this.options.repositoryRoot, runsDir, `${runId}.json`), `${JSON.stringify(written, null, 2)}\n`);
        this.summarize(written);
        return { value: undefined, ok: true };
      });
      return exitCode;
    };
    // The runtime of the agents is opened by the first step that calls the model.
    const agents = async (): Promise<CountedRuntime> => {
      if (counted === undefined) {
        open = await this.options.openRuntime(config);
        const { guardrailMinutes } = config.autonomy.limits;
        counted = new CountedRuntime(
          guardrailMinutes === null ? open.runtime : new GuardedRuntime(open.runtime, started.getTime() + guardrailMinutes * 60_000, () => now().getTime()),
        );
      }
      return counted;
    };
    const observed = this.options.follow === undefined ? {} : { observe: this.options.follow };
    const chain = async (): Promise<ExitCodeValue> => {
      // A run resumed in its design has its index already.
      const mapped =
        resumed?.stoppedBy!.step === "design"
          ? undefined
          : await timed("cartography", async () => {
              const outcome = await new Cartographer({
                config,
                environment,
                repositoryRoot: this.options.repositoryRoot,
                env: this.options.env,
                runtime: await agents(),
                concurrency: config.cartography.concurrency,
                ...observed,
                ...(this.options.force === true ? { force: true } : {}),
              }).run();
              this.relay(journal, "cartography", outcome.journal);
              return { value: outcome, ok: outcome.index !== undefined };
            });
      if (mapped?.ok === false) {
        const limit = mapped.value.stoppedBy;
        if (limit !== undefined) found = { stoppedBy: { step: "cartography", limit } };
        return ExitCode.interrupted;
      }
      found = { index: mapped === undefined ? resumed!.index! : this.inRepository(mapped.value.indexPath!) };
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
          runtime: await agents(),
          writerInstructions: writerInstructions(rules, config.repository),
          check: new CharterCheck({ repository: this.options.repositoryRoot, rules }),
          screenshots: rules.some((rule) => rule.id === SCREENSHOT_RULE),
          runner: trials,
          reviewPlan: config.design.reviewPlan,
          levels: config.design.levels,
          ...observed,
          ...(brief === undefined ? {} : { brief }),
          ...(resumed?.designState === undefined
            ? {}
            : { resume: { state: resumed.designState, ...(resumed.branch === undefined ? {} : { branch: resumed.branch }) } }),
        }).run();
        this.relay(journal, "design", outcome.journal);
        return { value: outcome, ok: outcome.ok };
      });
      const tests = designed.value.tests.map((test) => test.path);
      const { branch, statePath, stoppedBy, uncovered = [] } = designed.value;
      found = {
        ...found,
        ...(uncovered.length === 0 ? {} : { uncovered }),
        ...(branch === undefined ? {} : { branch }),
        designed: tests,
        ...(statePath === undefined ? {} : { designState: this.inRepository(statePath) }),
      };
      // A design a limit cut short can be resumed, even once it gave its tests.
      if (stoppedBy !== undefined) found = { ...found, stoppedBy: { step: "design", limit: stoppedBy } };
      const { run, leftOut } = runnableTests(designed.value.tests);
      // A design that left a scenario without a test still gave the others: they are run, and the run does not end as passed.
      // One a limit cut short is resumed instead, and one that gave no test to run has nothing to go on with.
      const partial = !designed.ok;
      if (partial && (stoppedBy !== undefined || run.length === 0)) return ExitCode.interrupted;
      if (partial) journal.record("design", "info", "The design is incomplete: the tests it gave are run, and the run cannot end as passed.");
      // A design whose plan holds no scenario gave no test: nothing is run, and nothing is verified.
      if (run.length === 0) {
        journal.record("design", "info", "No test is run: the design gave none.");
        return exitCodeOf([]);
      }
      const executed = await timed("execution", async () => {
        journal.record(
          "execution",
          "info",
          `${run.length} of the ${tests.length} tests designed are run; left out as unfinished, duplicate or unfeasible: ${leftOut.join(", ") || "none"}.`,
        );
        // The dependencies the design installed serve the execution as well.
        const outcome = await new PinnedRun({
          config,
          environment,
          repositoryRoot: this.options.repositoryRoot,
          tests: run,
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
      const code = exitCodeOf(result.tests.map((test) => test.verdict));
      return partial && code === ExitCode.passed ? ExitCode.unsettled : code;
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

  /** The configuration, the environment, the rules of the charter and the run to resume, or the exit code when they cannot be had. */
  private async configuration(
    journal: RunJournal,
    now: () => Date,
  ): Promise<{ config: ResolvedConfig; environment: string; rules: ActiveRule[]; durationMs: number; resumed?: SoloRunState } | ExitCodeValue> {
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
    const resumed = this.options.resume === undefined ? undefined : await this.resumable(result.config, journal, this.options.resume);
    if (typeof resumed === "number") return resumed;
    const declared = [...new Set(result.config.applications.flatMap((application) => application.environments.map((environment) => environment.name)))];
    const environment = resumed?.environment ?? this.options.environment ?? (declared.length === 1 ? declared[0] : undefined);
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
    return { config: result.config, environment, rules: charter.rules, durationMs, ...(resumed === undefined ? {} : { resumed }) };
  }

  /**
   * The state of the run to resume, or the exit code when it cannot be resumed: its state cannot be read,
   * no limit stopped it, or another run resumed it already.
   */
  private async resumable(config: ResolvedConfig, journal: RunJournal, runId: string): Promise<SoloRunState | ExitCodeValue> {
    const folder = join(this.options.repositoryRoot, config.repository.stateDir, RUNS_FOLDER);
    const path = join(folder, `${runId}.json`);
    const state = await readJson(path);
    if (!isRunState(state, runId)) {
      journal.record("configuration", "error", `The run ${runId} cannot be resumed: its state ${path} cannot be read.`);
      return ExitCode.configuration;
    }
    if (state.stoppedBy === undefined) {
      journal.record("configuration", "error", `The run ${runId} was not stopped by a limit; only a run a limit stopped can be resumed.`);
      return ExitCode.configuration;
    }
    const states = await Promise.all((await readdir(folder)).filter((name) => name.endsWith(".json")).map((name) => readJson(join(folder, name))));
    const resuming = states.find((other): other is SoloRunState => isRecord(other) && other["resumes"] === runId && typeof other["runId"] === "string");
    if (resuming !== undefined) {
      journal.record(
        "configuration",
        "error",
        `The run ${runId} was resumed already, by the run ${resuming.runId}; resume that one instead, if a limit stopped it.`,
      );
      return ExitCode.configuration;
    }
    journal.record("configuration", "info", `The run resumes ${runId}, which its ${state.stoppedBy.limit} limit stopped in its ${state.stoppedBy.step}.`);
    return state;
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
      ...(state.uncovered ?? []).map(({ asked, reason }) => `Not covered: ${asked} ${reason}`),
      ...(state.stoppedBy === undefined ? [] : [resumeHint(state)]),
      `State: ${posix.join(posix.dirname(state.journal), `${state.runId}.json`)}`,
    ];
    for (const line of lines) this.options.print(`${line}\n`);
  }
}

/** The JSON of a file, or `undefined` when it cannot be read or parsed. */
function readJson(path: string): Promise<unknown> {
  return readFile(path, "utf8")
    .then((text) => JSON.parse(text) as unknown)
    .catch(() => undefined);
}

/** Whether a value is an object, which the keys of a state can be read from. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Whether a value is absent or a string. */
function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

/**
 * Whether a value is the state of the run `runId`, with what a resume reads of it: its environment, its brief,
 * its design, and the step and the limit that stopped it, with its index when the step is the design.
 */
function isRunState(value: unknown, runId: string): value is SoloRunState {
  if (!isRecord(value) || value["formatVersion"] !== 1 || value["runId"] !== runId || typeof value["environment"] !== "string") return false;
  const stop = value["stoppedBy"];
  return (
    [value["brief"], value["branch"], value["designState"]].every(isOptionalString) &&
    (stop === undefined ||
      (isRecord(stop) &&
        typeof stop["limit"] === "string" &&
        (stop["step"] === "cartography" || (stop["step"] === "design" && typeof value["index"] === "string"))))
  );
}

/** How to resume a run a limit stopped. */
function resumeHint(state: SoloRunState): string {
  const { step, limit } = state.stoppedBy!;
  return `The ${step} was stopped by its ${limit} limit; resume the run with: oqas --resume ${state.runId}`;
}

/** The message of an error, or the value thrown. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
