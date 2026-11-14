import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import type { AgentEvent, AgentRuntime, PlanReview, StopReason } from "@open-qa-stack/domain";
import { validateDomainIndex, validateSourceCard, type DomainIndex, type ResolvedConfig, type SourceCard } from "@open-qa-stack/shared";
import type { BrowserAccess } from "@open-qa-stack/tools";
import { agentNotes } from "../common/agent-notes.ts";
import { runAgentTask, taskEnd, taskLimits } from "../common/agent-task.ts";
import { Journal, type JournalEntry } from "../common/journal.ts";
import { runTrace } from "../common/run-trace.ts";
import type { Trace } from "../common/trace.ts";
import type { TraceLine } from "../common/trace-line.ts";
import { TracedPhases } from "../common/traced-phases.ts";
import { INDEX_FILE_NAME } from "../cartographer/cartographer.ts";
import { CARDS_FOLDER } from "../source-cartographer/source-cartographer.ts";
import { designRequest, resumeRequest } from "./designer-prompt.ts";
import { DESIGNS_FOLDER, type DesignedTest, type DesignState } from "./design-state.ts";
import { IndexMap } from "./index-map.ts";
import { PLAN_FILE_SUFFIX, planFileText, readPlanFile, type PlanRecord } from "./plan-file.ts";
import { PlanProposal } from "./plan-proposal.ts";
import { sessionTools } from "./session-tools.ts";
import type { TestCheck, TestRunner } from "@open-qa-stack/domain";
import { declaredAddresses, declaredSecrets, testPackages } from "./spec-rules.ts";
import type { ToolDefinition } from "@open-qa-stack/domain";
import { MIN_TESTS, TestProposals, type AcceptedTest } from "./test-proposals.ts";
import { TestRepository } from "./test-repository.ts";

/** Prefix of the branches the designer creates. */
export const BRANCH_PREFIX = "oqas/";

/** What a design needs. */
export interface DesignerOptions {
  /** The resolved configuration. */
  readonly config: ResolvedConfig;
  /** Absolute path of the test repository, the root of a git repository. */
  readonly repositoryRoot: string;
  /** Environment holding the connection strings and credentials the configuration names. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The runtime that opens the agent's session. */
  readonly runtime: AgentRuntime;
  /** System instructions of the designer, composed from the test charter by the caller. */
  readonly instructions: string;
  /** A check run on each test before it is accepted, such as one against the charter; none by default. */
  readonly check?: TestCheck;
  /** Runs each test against the application before it is kept, such as the `TrialRunner` of the harness. */
  readonly runner: TestRunner;
  /** What the developer wants tested, in their own words: a domain, a ticket, a rule, a journey; the whole index when absent. */
  readonly brief?: string;
  /** Decides whether the test plan may be carried out; every plan is accepted as it is by default. */
  readonly planReview?: PlanReview;
  /** Whether each step of a test ends with a screenshot attached to the report, as the charter may ask; the skeleton of a test then holds it. `false` by default. */
  readonly screenshots?: boolean;
  /** Name of the branch to create; `oqas/design-<date>` by default. */
  readonly branch?: string;
  /**
   * A design a limit stopped: its state, relative to the test repository, and its branch once it holds a
   * test. The design goes on from its plan, without another, and its tests, on its branch, and updates its state.
   */
  readonly resume?: { readonly state: string; readonly branch?: string };
  /** How the browser starts and waits; a headless Chromium with the default waits otherwise. */
  readonly browser?: Pick<BrowserAccess, "launch" | "actionTimeoutMs" | "navigationTimeoutMs" | "settleTimeoutMs">;
  /** Receives each line of the trace as it is written, to follow the design while it runs. */
  readonly observe?: (line: TraceLine) => void;
  /** The clock of the dates; the system clock by default. */
  readonly now?: () => Date;
}

/** What a design produced. */
export interface DesignOutcome {
  /** Whether at least three tests were written that passed, or that fail because of the application. */
  readonly ok: boolean;
  /** The branch created, when tests were written; it is the one checked out. */
  readonly branch?: string;
  /** Where the design state was written, when it was. */
  readonly statePath?: string;
  /** Where the accepted plan was written, when the state was. */
  readonly planPath?: string;
  /** The tests written, in the order they were accepted. */
  readonly tests: readonly DesignedTest[];
  /** What the run checked, refused and wrote. */
  readonly journal: readonly JournalEntry[];
  /** Where the trace of the session is written, when a session started. */
  readonly tracePath?: string;
  /** The limit that cut the design short, when one stopped it before every scenario of its plan was closed. */
  readonly stoppedBy?: StopReason["limit"];
}

/** Accepts every plan as it is: the designer works on its own. */
const ACCEPT_EVERY_PLAN: PlanReview = { review: async () => ({ accepted: true }) };

/**
 * The designer: from a brief and the domain index of the test repository, it plans then writes three or
 * four Playwright tests on a new local branch, with the state of the design.
 *
 * @remarks
 * Before any session, the index must be readable, and the test repository must be the root of a git
 * repository with no tracked file changed, no untracked file outside the folders of the state and the index,
 * and no branch of the name to create; otherwise nothing is written. The agent gets the brief and what the
 * index holds for it, or the domains of the index when nothing of it echoes the brief, not the index whole:
 * it looks up the rest with `index_find` and `index_entry`, which name the tools of each source. It gets the browser tools of the applications, the
 * tools of every knowledge source of the environment — the bases read only — and the notes. It submits a
 * test plan with `propose_plan`, which `planReview` accepts or refuses; refused, the design stops and no
 * test is written. Once the plan is accepted, the harness opens its scenarios one at a time, in order, and
 * names the file of each test; the agent runs the test with `run_test`, through `runner`, against the
 * application, then closes the scenario with `propose_test`, under the limits of the configured autonomy,
 * every run counting against them. The test of a scenario is kept with the text of its last run: as passed,
 * or as failing with the cause the agent gives; its verdict is the harness's. Once the session is over, the
 * kept tests, in the folder of their application, and the design state are committed on a new branch from
 * the revision checked out, which stays checked out. Nothing contacts a remote. A design succeeds with three
 * tests that passed or that fail because of the application; with fewer, those kept are still written and
 * the design fails.
 *
 * The plan accepted is written with the state, to a file the state names: a page a person reads, then the
 * record the harness reads again. A design a limit stopped before every scenario of its plan was closed
 * keeps its plan, even without a test, and its tests in its state. Resumed from that state and that file, it checks out its branch, gives the agent the plan
 * and the tests kept, offers no `propose_plan`, opens the first scenario not closed, and commits the tests
 * it adds on the same branch, with the state updated.
 */
export class Designer {
  private readonly options: DesignerOptions;

  /** @param options - What the design needs. */
  public constructor(options: DesignerOptions) {
    this.options = options;
  }

  /**
   * Runs a design.
   *
   * @returns The branch and the tests written, if any, and the journal.
   * @throws Error when a file cannot be written, a test of the design resumed cannot be read, or git refuses the branch or the commit.
   */
  public async run(): Promise<DesignOutcome> {
    const { config, repositoryRoot, env } = this.options;
    // The trace opens with the session: a design stopped before it writes nothing to the test repository.
    let trace: Trace | undefined;
    const traced = () => (trace === undefined ? {} : { tracePath: trace.path });
    const journal = new Journal((entry) => trace?.harness("design", { type: "journal", level: entry.level, message: entry.message }));
    const failed = (message: string, stoppedBy?: StopReason["limit"]): DesignOutcome => {
      journal.record("error", message);
      return { ok: false, tests: [], journal: journal.entries(), ...traced(), ...(stoppedBy === undefined ? {} : { stoppedBy }) };
    };
    const now = this.options.now ?? (() => new Date());
    const start = now();
    const id = `design-${start.toISOString().replace(/[-:]|\.\d+/g, "")}`;
    const { resume } = this.options;
    const repository = new TestRepository(repositoryRoot);
    const created = this.options.branch ?? `${BRANCH_PREFIX}${id}`;
    const problems = await repository.problems(resume === undefined ? created : undefined, [config.repository.stateDir, config.repository.indexDir]);
    for (const problem of problems) journal.record("error", problem);
    if (problems.length > 0) return failed(resume === undefined ? "No branch was created and no file was written." : "The design was not resumed.");
    // The state of a design that holds a test may be committed on its branch only.
    if (resume?.branch !== undefined && (await repository.hasBranch(resume.branch))) await repository.switchTo(resume.branch);
    const resumed = await this.previous();
    if (typeof resumed === "string") return failed(resumed);
    const previous = resumed?.state;
    const frozen = resumed === undefined ? undefined : { scenarios: resumed.plan.scenarios };
    const branch = previous?.branch ?? created;
    const brief = previous === undefined ? this.options.brief : previous.brief;
    const index = await this.index();
    if (typeof index === "string") return failed(`No test was designed: ${index}`);

    const applications = config.applications.filter((application) => application.environments.some((environment) => environment.name === index.environment));
    const packages = testPackages(await readFile(join(repositoryRoot, "package.json"), "utf8").catch(() => undefined));
    const readable = config.knowledge.filter((source) => source.attachments.some((a) => a.environment === undefined || a.environment === index.environment));
    // The sources a scenario may cite and a tool may belong to: the index is a map, not a limit.
    const owners = [
      ...new Set([...index.sources.map((source) => source.id), ...readable.map((source) => source.id), ...applications.map((application) => application.id)]),
    ];
    const session = sessionTools({
      config,
      repositoryRoot,
      env,
      environment: index.environment,
      applications,
      sources: readable,
      start,
      browser: this.options.browser,
    });
    const { screens, reads } = session;
    const proposals = new TestProposals(
      {
        repositoryRoot,
        appsDir: config.repository.appsDir,
        addresses: declaredAddresses(config),
        secrets: declaredSecrets(config, env),
        ...(this.options.check === undefined ? {} : { check: this.options.check }),
        runner: this.options.runner,
        packages,
        screens,
        screenshots: this.options.screenshots ?? false,
        reads,
      },
      journal,
    );
    const plan = new PlanProposal(
      {
        sources: owners,
        applications: applications.map((application) => application.id),
        domains: index.domains.map((domain) => domain.id),
        secrets: declaredSecrets(config, env),
        screens,
        reads,
        review: this.options.planReview ?? ACCEPT_EVERY_PLAN,
        carry: (accepted) => proposals.start(accepted),
      },
      journal,
    );
    const knowledge = reads.tools();
    const notes = agentNotes(config, repositoryRoot, env, { role: "designer", task: id, now });
    const map = new IndexMap(index, await this.cards(index), [...screens.tools(), ...knowledge], owners);
    const events: AgentEvent[] = [];
    const request =
      previous === undefined
        ? designRequest(brief, index.environment, brief === undefined ? [] : map.found(brief), map.domains(), applications, packages)
        : resumeRequest(
            {
              environment: index.environment,
              ...(brief === undefined ? {} : { brief }),
              plan: frozen!,
              tests: await Promise.all(previous.tests.map(async (test) => ({ ...test, content: await readFile(join(repositoryRoot, test.path), "utf8") }))),
              unwritten: previous.unwritten.map((scenario) => scenario.scenario),
            },
            applications,
            packages,
            proposals.start(frozen!, previous.tests.length + previous.unwritten.length),
          );
    // A design resumed carries out the plan it accepted: it is offered no other.
    const planning = previous === undefined ? [plan.tool()] : [];
    const tools = [...map.toolset(), ...screens.tools(), ...knowledge, ...notes, ...planning, proposals.trialTool(), proposals.tool()].map((tool) =>
      stoppedOnRefusal(tool, plan),
    );
    const opened = runTrace(this.options, `design-${index.environment}`, now);
    trace = opened;
    const phases = new TracedPhases(opened, "design");
    phases.start("design");
    const task = {
      instructions: this.options.instructions,
      tools,
      request,
      events,
      reminder: () => (previous === undefined ? plan.reminder() : undefined) ?? proposals.reminder(),
      sent: (text: string) => opened.harness("design", { type: "message", text }),
      received: (event: AgentEvent) => {
        opened.agent("design", event);
        if (event.type === "tool-error") journal.record("error", `${event.tool}: ${event.message}`);
      },
    };
    // A design that fails or throws leaves its phase ended as failed.
    try {
      await runAgentTask(this.options.runtime, task, taskLimits(config)).finally(() => session.close());
      const { last, counters } = taskEnd(events);
      if (last.type === "error") journal.record("error", `The session failed: ${last.error.message}`);
      if (last.type === "stopped") journal.record("error", `The task reached its ${last.reason.limit} limit; no test was written for the scenario under way.`);

      if (plan.refused !== undefined) return failed(`No test was written: the plan was refused: ${plan.refused}`);
      const planned = frozen ?? plan.accepted;
      // A limit cuts the design short while its plan is to come, or a scenario of it is open.
      const stoppedBy = last.type === "stopped" && (planned === undefined || proposals.pending) ? last.reason.limit : undefined;
      const tests = proposals.accepted;
      const kept = [
        ...(previous?.tests ?? []),
        ...tests.map(({ content: _content, references, ...test }) => ({
          ...test,
          ...(references.length === 0 ? {} : { references: references.map((reference) => reference.path) }),
        })),
      ];
      if (planned === undefined || (kept.length === 0 && stoppedBy === undefined))
        return failed(`No test was written: ${obtained(0)}, ${MIN_TESTS} at least are expected.`, stoppedBy);
      const used = { iterations: counters.iterations, actions: counters.actions, durationMs: Math.round(counters.elapsedMs) };
      const record: PlanRecord = resumed?.plan ?? {
        formatVersion: 1,
        design: id,
        environment: index.environment,
        ...(brief === undefined ? {} : { brief }),
        scenarios: planned.scenarios,
      };
      const state: DesignState = {
        formatVersion: 3,
        producedAt: previous?.producedAt ?? start.toISOString(),
        environment: index.environment,
        ...(brief === undefined ? {} : { brief }),
        plan: previous?.plan ?? posix.join(config.repository.stateDir, DESIGNS_FOLDER, `${id}${PLAN_FILE_SUFFIX}`),
        branch,
        // A branch still to create starts from the revision checked out now.
        base: previous !== undefined && previous.tests.length > 0 ? previous.base : await repository.head(),
        model: { provider: config.model.provider, baseUrl: config.model.baseUrl, model: config.model.model },
        run:
          previous === undefined
            ? used
            : {
                iterations: previous.run.iterations + used.iterations,
                actions: previous.run.actions + used.actions,
                durationMs: previous.run.durationMs + used.durationMs,
              },
        tests: kept,
        unwritten: [...(previous?.unwritten ?? []), ...proposals.unwritten],
      };
      const statePath = resume?.state ?? posix.join(config.repository.stateDir, DESIGNS_FOLDER, `${id}.json`);
      await this.write(repository, state, statePath, record, tests, journal);
      const counted = kept.filter((test) => test.verdict === "passed" || test.quarantine?.cause === "application").length;
      if (counted < MIN_TESTS) journal.record("error", `The design failed: ${obtained(counted)}, ${MIN_TESTS} at least are expected.`);
      const ok = counted >= MIN_TESTS;
      if (ok) phases.end(last.type === "end" ? "done" : "truncated");
      return {
        ok,
        ...(kept.length === 0 ? {} : { branch }),
        statePath: join(repositoryRoot, statePath),
        planPath: join(repositoryRoot, state.plan),
        tests: kept,
        journal: journal.entries(),
        tracePath: opened.path,
        ...(stoppedBy === undefined ? {} : { stoppedBy }),
      };
    } finally {
      phases.close();
    }
  }

  /** Writes the state, the file of its plan and the new tests and, with a test at least, commits them on the branch, created if need be. */
  private async write(
    repository: TestRepository,
    state: DesignState,
    statePath: string,
    plan: PlanRecord,
    tests: readonly AcceptedTest[],
    journal: Journal,
  ): Promise<void> {
    const { repositoryRoot } = this.options;
    if (tests.length > 0 && !(await repository.hasBranch(state.branch))) await repository.createBranch(state.branch);
    const files: (readonly [string, string | Uint8Array])[] = [
      ...tests.map((test) => [test.path, test.content.endsWith("\n") ? test.content : `${test.content}\n`] as const),
      ...tests.flatMap((test) => test.references.map((reference) => [reference.path, reference.content] as const)),
      [state.plan, planFileText(plan)] as const,
      [statePath, `${JSON.stringify(state, null, 2)}\n`] as const,
    ];
    for (const [path, content] of files) {
      await mkdir(dirname(join(repositoryRoot, path)), { recursive: true });
      await writeFile(join(repositoryRoot, path), content);
    }
    if (tests.length === 0) {
      journal.record(
        "info",
        `The design state was written to ${statePath}, and its plan to ${state.plan}; no new test was written, and nothing was committed.`,
      );
      return;
    }
    const titles = new Map(plan.scenarios.map((scenario) => [scenario.id, scenario.title]));
    const line = (test: AcceptedTest) =>
      test.quarantine === undefined
        ? `- ${test.path}: ${titles.get(test.scenario)}`
        : `- ${test.path}: failing (${test.quarantine.cause})${stepOf(test.quarantine.failedStep)}`;
    const message = [`test: add ${tests.length} generated Playwright tests`, "", ...tests.map(line)].join("\n");
    const committed = new Set(
      await repository.commit(
        files.map(([path]) => path),
        message,
      ),
    );
    for (const test of tests) journal.record("info", `The test ${test.path} was written.`);
    const ignored = (path: string) => (committed.has(path) ? "" : ", which git ignores: it was not committed");
    journal.record("info", `The plan was written to ${state.plan}${ignored(state.plan)}.`);
    journal.record("info", `The design state was written to ${statePath}${ignored(statePath)}.`);
    journal.record("info", `The tests were committed on ${state.branch}; the active branch of the test repository is ${await repository.branch()}.`);
  }

  /** The state of the design to resume and the plan its file records, none for a new design, or why it cannot be resumed. */
  private async previous(): Promise<{ readonly state: DesignState; readonly plan: PlanRecord } | undefined | string> {
    const path = this.options.resume?.state;
    if (path === undefined) return undefined;
    const { repositoryRoot } = this.options;
    const state = (await readJson(join(repositoryRoot, path))) as DesignState | undefined;
    if (state?.formatVersion !== 3) return `The design state ${path} cannot be read; the design was not resumed.`;
    const plan = readPlanFile(await readFile(join(repositoryRoot, state.plan), "utf8").catch(() => ""));
    if (plan === undefined) return `The plan ${state.plan} of the design state ${path} cannot be read; the design was not resumed.`;
    if (state.tests.length + state.unwritten.length >= plan.scenarios.length)
      return `Every scenario of the plan of ${path} is closed; there is nothing to resume.`;
    return { state, plan };
  }

  /** The domain index, or why it cannot be read. */
  private async index(): Promise<DomainIndex | string> {
    const path = join(this.options.repositoryRoot, this.options.config.repository.indexDir, INDEX_FILE_NAME);
    const content = await readJson(path);
    if (content === undefined) return `the domain index ${path} cannot be read.`;
    const validation = validateDomainIndex(content);
    return validation.ok
      ? validation.value
      : `the domain index ${path} does not match its schema: ${validation.errors.map((error) => error.message).join(" ")}`;
  }

  /** The cards of the sources of the index that have a readable one. */
  private async cards(index: DomainIndex): Promise<Map<string, SourceCard>> {
    const folder = join(this.options.repositoryRoot, this.options.config.repository.indexDir, CARDS_FOLDER);
    const read = await Promise.all(
      index.sources.map(async (source) => {
        const validation = validateSourceCard(await readJson(join(folder, `${source.id}.json`)));
        return validation.ok ? [[source.id, validation.value] as const] : [];
      }),
    );
    return new Map(read.flat());
  }
}

/** A tool that refuses every call once the plan is refused: the design is stopped. */
function stoppedOnRefusal(tool: ToolDefinition, plan: PlanProposal): ToolDefinition {
  return { ...tool, execute: async (args) => (plan.refused === undefined ? tool.execute(args) : { error: plan.blocked() }) };
}

/** Where a test kept failing failed, in words: the number of its step, when the title of the step gives it. */
function stepOf(failedStep: string | undefined): string {
  const number = failedStep === undefined ? undefined : /^(\d+)\. /.exec(failedStep)?.[1];
  return number === undefined ? "" : ` at step ${number}`;
}

/** How many tests a design obtained, in words. */
function obtained(count: number): string {
  return `${count} ${count === 1 ? "test was" : "tests were"} obtained`;
}

/** The JSON value of a file; `undefined` when it cannot be read or parsed. */
async function readJson(path: string): Promise<unknown> {
  return readFile(path, "utf8")
    .then(
      (text) => JSON.parse(text) as unknown,
      () => undefined,
    )
    .catch(() => undefined);
}
