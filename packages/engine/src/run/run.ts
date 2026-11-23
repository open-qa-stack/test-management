import { START_ADVICE } from "../configuration/start-advice.ts";
import { posix, relative, sep } from "node:path";
import {
  CONFIG_FILE_NAME,
  runIdAt,
  declaredValues,
  storedDocumentSources,
  ExitCode,
  InvalidConfigurationError,
  NoConfigurationError,
  scopedConfig,
  validateConfig,
  type ConfigurationRevision,
  type CommandRunner,
  type DocumentStorePort,
  type ExitCodeValue,
  type MemoryStorePort,
  type ResolvedConfig,
  type RunState,
  type Step,
  type TestVerdict,
  type TraceLine,
} from "@open-qa-stack/domain";
import { Cartographer, Designer, DesignPasses, type Inbox, type JournalEntry } from "@open-qa-stack/agents";
import {
  CharterCheck,
  reviewerInstructions,
  writerInstructions,
  LocalRunner,
  PinnedRun,
  resolveCharter,
  TrialRunner,
  type ActiveRule,
} from "@open-qa-stack/harness";
import type { SessionScope } from "@open-qa-stack/domain/sessions";
import type { ConfigurationSource } from "../ports/configuration-source.ts";
import type { JournalOutput } from "../ports/journal-output.ts";
import type { OpenRuntime } from "../ports/open-runtime.ts";
import type { RunReference } from "../ports/run-reference.ts";
import type { RunStore } from "../ports/run-store.ts";
import { CountedRuntime } from "../runtime/counted-runtime.ts";
import { GuardedRuntime } from "../runtime/guarded-runtime.ts";
import { RunStoppedError } from "../runtime/run-stopped-error.ts";
import { SpokenRuntime } from "../runtime/spoken-runtime.ts";
import { StoppableRuntime } from "../runtime/stoppable-runtime.ts";
import { exitCodeOf } from "./exit-code.ts";
import { missingPrerequisites } from "./prerequisites.ts";
import { RunJournal } from "./run-journal.ts";
import { runnableTests } from "./runnable-tests.ts";
import { writeStoredDocuments } from "./stored-documents.ts";

/** The rule of the charter that ends each step of a test with a screenshot, which the skeleton of a test then holds. */
const SCREENSHOT_RULE = "PW-SHOT-01";

/** What a run needs: what to run, and the ports its host plugs it into. */
export interface RunOptions {
  /** Absolute path of the test repository, the folder the run works in. */
  readonly repositoryRoot: string;
  /** The environment to run against; the only one declared by default. */
  readonly environment?: string;
  /** What to test, in the developer's words; the designer works on the whole domain index without it. */
  readonly brief?: string;
  /** `map` for a run that maps the knowledge alone: it ends once the index is written, and designs no test. */
  readonly purpose?: "map";
  /**
   * The branch of an earlier run whose tests this one goes on with: the design checks it out and commits on it, and
   * the state names it whatever the design wrote; a new branch by default.
   */
  readonly branch?: string;
  /** Where the configuration is read: the revision in force, once it is in step with the configuration file. */
  readonly configuration: ConfigurationSource;
  /**
   * What of the project the run keeps its work to: the configuration is kept to its applications and levels, and the
   * design to its domains; the whole project when left out.
   */
  readonly scope?: SessionScope;
  /** Where the documents of the knowledge sources the instance keeps are read, which the cartography writes to the state folder first. */
  readonly documents: Pick<DocumentStorePort, "documents">;
  /** Where the memories of the agents are kept, which they recall and add to. */
  readonly memory: MemoryStorePort;
  /** The environment of the process: the secrets and the accounts the configuration names. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Receives the journal, an entry at a time, and keeps it. */
  readonly journal: JournalOutput;
  /** Receives each line of the trace of the agents as it is written, to follow the run; nothing follows it otherwise. */
  readonly follow?: (line: TraceLine) => void;
  /** Opens the inbox of the run, which a person speaks to its agents through: the messages they send while it is going, wherever the host takes them from. */
  readonly openInbox: (run: RunReference) => Inbox;
  /** Keeps the state of the run. */
  readonly store: RunStore;
  /** Opens the runtime of the agents on the model of the configuration. */
  readonly openRuntime: (config: ResolvedConfig) => Promise<OpenRuntime>;
  /** Runs the commands of the machine and of the tests; a `LocalRunner` in the test repository by default. */
  readonly runner?: CommandRunner;
  /** The clock; the system clock by default. */
  readonly now?: () => Date;
  /** Aborted by the host to ask the run to stop: its agents refuse to go on, no other step starts, and the run goes to its summary. */
  readonly stop?: AbortSignal;
}

/**
 * A run of the engine: it reads the configuration in force, checks the machine, maps the target, designs tests on a
 * new local branch, or on the branch of an earlier run it goes on with, runs them, and writes a summary.
 *
 * @remarks
 * The run works in the test repository, a folder, whoever hosts it: the branch, the tests, the cards and the
 * traces are written there. What differs from a host to another goes through the ports of its options: the
 * configuration, the documents the instance keeps, the memory of the agents, the journal, the inbox, the store of the state, the runtime of
 * the agents, the commands and the clock. The cartography starts by writing those documents to the state folder,
 * where the agents read them.
 *
 * Each step starts only when the one before succeeded; once the prerequisites passed, the summary closes the
 * runtime of the agents and writes the state whatever the end of the others. A missing or invalid configuration stops the run
 * before anything else, with nothing written to the test repository. Nothing is pushed, and the git
 * configuration of the repository is left as it is. The journal goes to its output, which keeps it once the
 * prerequisites passed; every declared secret is masked. The guardrail of the
 * autonomy, counted from the start of the run, stops every task of the agents.
 *
 * While the run is going, a person speaks to its agents through its inbox: the session that leads the step
 * under way receives a message, and those that lead a step later in the run are recalled it. A message no
 * session could receive is told in the journal of the summary.
 *
 * A host stops a run by aborting the signal it gave it. Nothing is killed: the runtime of the agents refuses
 * to go on, the step under way stops on that refusal, no other step starts, and the summary closes the run,
 * which ends as one a step stopped.
 *
 * A run a limit stopped in its cartography or its design keeps what it produced, and says so: the cards made,
 * the plan accepted and the tests kept stay in the test repository. It is not resumed: the next run maps only
 * the sources without an up-to-date card, and designs anew.
 */
export class Run {
  private readonly options: RunOptions;

  /** @param options - What the run needs. */
  public constructor(options: RunOptions) {
    this.options = options;
  }

  /**
   * Runs the steps, in order.
   *
   * @returns The exit code; `5` when a step stopped on an unexpected error, which the journal tells.
   * @throws Error when the journal or the state of the run cannot be written, or an output refuses a line.
   */
  public async run(): Promise<ExitCodeValue> {
    const now = this.options.now ?? (() => new Date());
    const started = now();
    const early = new RunJournal(this.options.journal, now, []);
    const loaded = await this.configuration(early, now);
    if (typeof loaded === "number") return loaded;
    const { config, environment, rules, stored } = loaded;
    const { brief } = this.options;
    const journal = new RunJournal(this.options.journal, now, declaredValues(config, this.options.env));
    journal.adopt(early.entries);
    const runId = runIdAt(started);
    const reference: RunReference = { runId, stateDir: config.repository.stateDir };
    // What a person sends to the inbox while the run is going reaches the agent at work, and holds for those after it.
    const inbox = this.options.openInbox(reference);
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
        journal.record(step, "finished", ok ? succeeded(step) : `The ${step} did not succeed.`, { durationMs, modelRequests });
      };
      try {
        journal.record(step, "started", `The ${step} starts.`);
        const done = await body();
        close(done.ok);
        return done;
      } catch (error) {
        journal.record(
          step,
          "error",
          error instanceof RunStoppedError
            ? `The ${step} stopped: the run was asked to stop.`
            : `The ${step} stopped on an unexpected error: ${messageOf(error)}`,
        );
        close(false);
        throw error;
      }
    };
    // A run asked to stop starts no other step of its chain: the one that would have started tells so.
    const unlessStopped: typeof timed = (name, body) => {
      if (this.options.stop?.aborted !== true) return timed(name, body);
      journal.record(name, "info", `The run was asked to stop: the ${name} does not start.`);
      throw new RunStoppedError();
    };
    const runner = this.options.runner ?? new LocalRunner(this.options.repositoryRoot);
    const prerequisites = await timed("prerequisites", async () => {
      const missing = await missingPrerequisites(config, this.options.repositoryRoot, runner, this.options.env);
      for (const problem of missing) journal.record("prerequisites", "error", problem);
      return { value: missing, ok: missing.length === 0 };
    });
    if (!prerequisites.ok) return ExitCode.prerequisite;
    journal.keep(reference);
    const state = {
      formatVersion: 1 as const,
      runId,
      environment,
      ...(brief === undefined ? {} : { brief }),
      startedAt: started.toISOString(),
      designed: [] as string[],
      tests: [] as TestVerdict[],
      journal: this.options.journal.location(reference),
    };
    let found: Partial<RunState> = {};
    let open: OpenRuntime | undefined;
    const finish = async (exitCode: ExitCodeValue): Promise<ExitCodeValue> => {
      const written: RunState = { ...state, ...found, exitCode, steps, durationMs: now().getTime() - started.getTime() };
      await timed("summary", async () => {
        if (written.stoppedBy !== undefined) journal.record("summary", "info", stoppedByLimit(written));
        // A message that came once no session would open any more was read by no one: the person is told which.
        for (const { number } of inbox.pending())
          journal.record("summary", "info", `The message ${number} of the person was not delivered: no agent was at work to receive it.`);
        // A runtime that cannot be closed is told, and the state is written all the same.
        await open?.close().catch((error: unknown) => journal.record("summary", "error", `The runtime of the agents could not be closed: ${messageOf(error)}`));
        await this.options.store.write(reference, written);
        return { value: undefined, ok: true };
      });
      return exitCode;
    };
    // The runtime of the agents is opened by the first step that calls the model.
    const agents = async (): Promise<CountedRuntime> => {
      if (counted === undefined) {
        open = await this.options.openRuntime(config);
        const { guardrailMinutes } = config.autonomy.limits;
        // Every session of the run speaks to the person in their language.
        const spoken = new SpokenRuntime(open.runtime, config.language);
        const stoppable = this.options.stop === undefined ? spoken : new StoppableRuntime(spoken, this.options.stop);
        counted = new CountedRuntime(new GuardedRuntime(stoppable, started.getTime() + guardrailMinutes * 60_000, () => now().getTime()));
      }
      return counted;
    };
    const observed = { inbox, ...(this.options.follow === undefined ? {} : { observe: this.options.follow }) };
    const chain = async (): Promise<ExitCodeValue> => {
      const mapped = await unlessStopped("cartography", async () => {
        // The agents read the documents the instance keeps where they read those of the repository: in a folder.
        await writeStoredDocuments(this.options.repositoryRoot, config.repository.stateDir, stored, this.options.documents);
        const outcome = await new Cartographer({
          config,
          environment,
          repositoryRoot: this.options.repositoryRoot,
          env: this.options.env,
          runtime: await agents(),
          memory: this.options.memory,
          concurrency: config.cartography.concurrency,
          ...observed,
        }).run();
        this.relay(journal, "cartography", outcome.journal);
        return { value: outcome, ok: outcome.index !== undefined };
      });
      if (!mapped.ok) {
        const limit = mapped.value.stoppedBy;
        if (limit !== undefined) found = { stoppedBy: { step: "cartography", limit } };
        return ExitCode.interrupted;
      }
      found = { index: this.inRepository(mapped.value.indexPath!) };
      if (this.options.purpose === "map") return ExitCode.passed;
      const trials = new TrialRunner({ config, environment, repositoryRoot: this.options.repositoryRoot, runner, env: this.options.env });
      const designed = await unlessStopped("design", async () => {
        // The tests are checked against the dependencies of the test repository: they are installed first.
        const prepared = await trials.prepare();
        if (!prepared.ok) {
          journal.record("design", "error", prepared.reason);
          return { value: { ok: false, tests: [], journal: [] } as Awaited<ReturnType<Designer["run"]>>, ok: false };
        }
        // The levels asked are designed one after the other, each building on those below, unless the configuration asks for one plan.
        const outcome = await new DesignPasses(
          {
            config,
            repositoryRoot: this.options.repositoryRoot,
            env: this.options.env,
            runtime: await agents(),
            memory: this.options.memory,
            writerInstructions: writerInstructions(rules, config.repository, config.design.architecture),
            check: new CharterCheck({ repository: this.options.repositoryRoot, rules }),
            screenshots: rules.some((rule) => rule.id === SCREENSHOT_RULE),
            runner: trials,
            reviewPlan: config.design.reviewPlan,
            reviewTests: config.design.reviewTests,
            reviewCode: config.design.reviewCode,
            reviewerInstructions: reviewerInstructions(rules, config.repository, config.design.architecture),
            levels: config.design.levels,
            ...(this.options.scope?.domains === undefined ? {} : { domains: this.options.scope.domains }),
            ...observed,
            ...(brief === undefined ? {} : { brief }),
            ...(this.options.branch === undefined ? {} : { continuedBranch: this.options.branch }),
          },
          config.design.passes,
          config.design.visualTests,
          (pass) => new Designer(pass).run(),
        ).run();
        this.relay(journal, "design", outcome.journal);
        return { value: outcome, ok: outcome.ok };
      });
      const tests = designed.value.tests.map((test) => test.path);
      const { statePath, stoppedBy, uncovered = [] } = designed.value;
      // The tests of a run that goes on with an earlier one are on its branch, whether this one added any or not.
      const branch = designed.value.branch ?? this.options.branch;
      found = {
        ...found,
        ...(uncovered.length === 0 ? {} : { uncovered }),
        ...(branch === undefined ? {} : { branch }),
        designed: tests,
        ...(statePath === undefined ? {} : { designState: this.inRepository(statePath) }),
      };
      // A design a limit cut short says so, even once it gave its tests.
      if (stoppedBy !== undefined) found = { ...found, stoppedBy: { step: "design", limit: stoppedBy } };
      const { run, leftOut } = runnableTests(designed.value.tests);
      // A design that left a scenario without a test still gave the others: they are run, and the run does not end as passed.
      // One a limit cut short runs none of them, and one that gave no test to run has nothing to go on with.
      const partial = !designed.ok;
      if (partial && (stoppedBy !== undefined || run.length === 0)) return ExitCode.interrupted;
      if (partial) journal.record("design", "info", "The design is incomplete: the tests it gave are run, and the run cannot end as passed.");
      // A design whose plan holds no scenario gave no test: nothing is run, and nothing is verified.
      if (run.length === 0) {
        journal.record("design", "info", "No test is run: the design gave none.");
        return exitCodeOf([]);
      }
      const executed = await unlessStopped("execution", async () => {
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

  /** The configuration, the environment and the rules of the charter, or the exit code when they cannot be had. */
  private async configuration(
    journal: RunJournal,
    now: () => Date,
  ): Promise<{ config: ResolvedConfig; environment: string; rules: ActiveRule[]; stored: string[]; durationMs: number } | ExitCodeValue> {
    const at = now().getTime();
    journal.record("configuration", "started", "The configuration starts.");
    const revision = await this.options.configuration.current().catch((error: unknown) => refused(journal, error));
    if (revision === undefined) return ExitCode.configuration;
    const result = validateConfig(JSON.stringify(revision.document), this.options.env);
    if (!result.ok) {
      // The revision is valid by the schema: what is left is the environment, each error at the key that names a variable.
      for (const error of result.errors) journal.record("configuration", "error", `${error.path}: ${error.message}`);
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
    const scoped = scopedConfig(result.config, this.options.scope);
    if (!scoped.ok) {
      for (const error of scoped.errors) journal.record("configuration", "error", error);
      return ExitCode.configuration;
    }
    const config = scoped.config;
    const charter = resolveCharter(config.charter);
    if (!charter.ok) {
      for (const error of charter.errors) journal.record("configuration", "error", `${error.path}: ${error.message}`);
      return ExitCode.configuration;
    }
    const durationMs = now().getTime() - at;
    journal.record("configuration", "finished", `The configuration is valid; the run targets the environment ${environment}.`, {
      durationMs,
      modelRequests: 0,
      scope: {
        environment,
        applications: config.applications.map((application) => application.id),
        levels: config.design.levels,
        ...(this.options.scope?.domains === undefined ? {} : { domains: this.options.scope.domains }),
      },
    });
    return { config, environment, rules: charter.rules, stored: storedDocumentSources(revision.document), durationMs };
  }

  /** Writes the entries of the journal of a role to the journal of the run. */
  private relay(journal: RunJournal, step: Step, entries: readonly JournalEntry[]): void {
    for (const entry of entries) journal.record(step, entry.level, entry.source === undefined ? entry.message : `${entry.source}: ${entry.message}`);
  }
}

/**
 * What the journal says of a step that succeeded. The summary is written whatever the run came to: it says so,
 * rather than read as a run that succeeded.
 */
function succeeded(step: Step): string {
  return step === "summary" ? "The summary of the run was written." : `The ${step} succeeded.`;
}

/**
 * Tells in the journal why the configuration cannot be had, and what to do.
 *
 * @returns Nothing, once it is told.
 * @throws The error, when it is not one the configuration refuses with: the store cannot be read.
 */
function refused(journal: RunJournal, error: unknown): ConfigurationRevision | undefined {
  if (error instanceof NoConfigurationError) {
    journal.record("configuration", "error", `${error.message} ${START_ADVICE}`);
    return undefined;
  }
  if (!(error instanceof InvalidConfigurationError)) throw error;
  for (const found of error.errors) journal.record("configuration", "error", `${found.path || "/"}: ${found.message}`);
  // A run reads the file only on an instance that keeps no revision: there is none in force to write over it.
  journal.record("configuration", "error", `${CONFIG_FILE_NAME} is not a valid configuration: correct it.`);
  return undefined;
}

/** What the summary of a run a limit stopped says of it. */
function stoppedByLimit(state: RunState): string {
  const { step, limit } = state.stoppedBy!;
  return `The ${step} was stopped by its ${limit} limit: what it produced is kept in the test repository.`;
}

/** The message of an error, or the value thrown. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
