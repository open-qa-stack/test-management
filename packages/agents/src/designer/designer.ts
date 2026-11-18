import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import {
  CONFIG_FILE_NAME,
  validateDomainIndex,
  validateSourceCard,
  validateSourceManifest,
  type AgentEvent,
  type AgentRuntime,
  type DomainIndex,
  type Knowledge,
  type PlanReview,
  type ResolvedConfig,
  type ScenarioLevel,
  type SourceCard,
  type StopReason,
  type TerminalEvent,
  type TestCheck,
  type TestPlan,
  type TestRunner,
  type ToolDefinition,
  type TraceLine,
  type TracePhase,
  type UncoveredRequest,
} from "@open-qa-stack/domain";
import { PlaywrightReference, playwrightTools, type BrowserAccess } from "@open-qa-stack/tools";
import { agentNotes, agentRecall } from "../common/agent-notes.ts";
import { runAgentTask, taskEnd, taskLimits, type AgentTask } from "../common/agent-task.ts";
import { usageOf } from "../common/model-usage.ts";
import { Journal, type JournalEntry } from "../common/journal.ts";
import { testLanguageRule } from "../common/language-rules.ts";
import { PersonDelivery } from "../common/person-delivery.ts";
import type { Inbox } from "../common/inbox.ts";
import { runTrace } from "../common/run-trace.ts";
import type { Trace } from "../common/trace.ts";
import { TracedPhases } from "../common/traced-phases.ts";
import { INDEX_FILE_NAME } from "../cartographer/cartographer.ts";
import { CARDS_FOLDER } from "../source-cartographer/source-cartographer.ts";
import { DESIGNS_FOLDER, type DesignedTest, type DesignState, type TestClass } from "./design-state.ts";
import { MANIFEST_FILE } from "../source-workflow/source-folder.ts";
import { IndexMap, type WrittenSource } from "./index-map.ts";
import { CodeReviewer } from "../code-reviewer/code-reviewer.ts";
import { CoherenceReviewer } from "../coherence-reviewer/coherence-reviewer.ts";
import { PlanReviewer } from "../plan-reviewer/plan-reviewer.ts";
import { PLAN_FILE_SUFFIX, planFileText, type PlanRecord } from "./plan-file.ts";
import { PlanProposal } from "./plan-proposal.ts";
import { PLANNER_INSTRUCTIONS, planRequest } from "./planner-prompt.ts";
import { sessionTools, type SessionTools } from "./session-tools.ts";
import { declaredAddresses, declaredSecrets, TEST_MODULE, testPackages } from "./spec-rules.ts";
import { PageObjects } from "./page-objects.ts";
import { coveringTests, existingTestTools, existingTests, plannedTests, type ExistingTest } from "./existing-tests.ts";
import { ensureFixtures } from "./test-fixtures.ts";
import { uncomparedScreens, withComparisons } from "./visual-scenarios.ts";
import { WrittenFiles } from "./written-files.ts";
import { SESSION_END, TestProposals, type AcceptedTest } from "./test-proposals.ts";
import { TestRepairs, type TestRepair } from "./test-repairs.ts";
import { TestRepository } from "./test-repository.ts";
import { SheetWatch } from "./sheet-watch.ts";
import { writeRequest, type RepairedTest } from "./writer-prompt.ts";

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
  /** System instructions of the agent that writes each test, composed from the test charter by the caller, such as `writerInstructions` of the harness gives them. */
  readonly writerInstructions: string;
  /** A check run on each test before it is accepted, such as one against the charter; none by default. */
  readonly check?: TestCheck;
  /** Runs each test against the application before it is kept, such as the `TrialRunner` of the harness. */
  readonly runner: TestRunner;
  /** What the developer wants tested, in their own words: a domain, a ticket, a rule, a journey; the whole index when absent. */
  readonly brief?: string;
  /** Decides whether the test plan may be carried out; every plan is accepted as it is by default. */
  readonly planReview?: PlanReview;
  /** Whether the agent that reviews plans is asked which scenarios verify what another already does, in sessions of its own; the harness compares them by their code alone otherwise. `false` by default. */
  readonly reviewPlan?: boolean;
  /** Whether the agent that reviews coherence reads each test that passed against its scenario, in a session of its own, before the test is kept: its findings are told once to the agent that wrote the test, and kept with it. `false` by default. */
  readonly reviewTests?: boolean;
  /** System instructions of the agent that reviews the quality of the code of each test that passed, composed from the test charter by the caller, such as `reviewerInstructions` of the harness. Its findings are told once to the agent that wrote the test, and kept with it. */
  readonly reviewerInstructions?: string;
  /** Whether the agent that reviews the code of the tests does so, with `reviewerInstructions`; `false` by default, and without those instructions. */
  readonly reviewCode?: boolean;
  /** The levels of the pyramid of tests the plan is asked for; `smoke`, `functional` and `business` by default. */
  readonly levels?: readonly ScenarioLevel[];
  /**
   * Whether the plan is of visual tests alone: the agent that plans says which states of the screens to compare, and the harness adds
   * the comparison of each with its reference.
   */
  readonly visual?: boolean;
  /** Whether each step of a test ends with a screenshot attached to the report, as the charter may ask; the skeleton of a test then holds it. `false` by default. */
  readonly screenshots?: boolean;
  /** Name of the branch to create; `oqas/design-<date>` by default. */
  readonly branch?: string;
  /**
   * The branch of an earlier design to go on with, in place of a new one: it is checked out before anything is
   * read, so that the agents find the tests it holds, and the tests of this design are committed on it.
   */
  readonly continuedBranch?: string;
  /** How the browser starts and waits; a headless Chromium with the default waits otherwise. */
  readonly browser?: Pick<BrowserAccess, "launch" | "actionTimeoutMs" | "navigationTimeoutMs" | "settleTimeoutMs">;
  /** Receives each line of the trace as it is written, to follow the design while it runs. */
  readonly observe?: (line: TraceLine) => void;
  /** The inbox of the run: the session that plans and that of each scenario are given the messages a person sends while they are open, and recalled those delivered earlier in the run. No session hears anyone without it. */
  readonly inbox?: Inbox;
  /** The clock of the dates; the system clock by default. */
  readonly now?: () => Date;
}

/** What a design produced. */
export interface DesignOutcome {
  /** Whether each scenario of the plan has a test that passed, or that fails because of the application. */
  readonly ok: boolean;
  /** The branch the tests were committed on, when they were: the one created, or the one gone on with; it is the one checked out. */
  readonly branch?: string;
  /** Where the design state was written, when it was. */
  readonly statePath?: string;
  /** Where the accepted plan was written, when the state was. */
  readonly planPath?: string;
  /** What the brief asks and the accepted plan leaves out, because the application does not allow it; none when the plan covers the brief, or without a plan. */
  readonly uncovered?: readonly UncoveredRequest[];
  /** The test of each scenario closed, in the order of the plan. */
  readonly tests: readonly DesignedTest[];
  /** What the run checked, refused and wrote. */
  readonly journal: readonly JournalEntry[];
  /** Where the trace of the sessions is written, when a session started. */
  readonly tracePath?: string;
  /** The limit that cut the design short, when one stopped the session that plans before its plan, or the session of a scenario while it was open. */
  readonly stoppedBy?: StopReason["limit"];
  /** Whether the design stopped before its first session, on the test repository or the index: another pass would stop on them too. */
  readonly unstarted?: true;
  /** Whether the design repaired tests the repository has instead of planning new ones: the repair is the whole design. */
  readonly repaired?: true;
}

/** The types of the sources that tell why a run failed, which the session of every scenario may read. */
const INSPECTED = new Set<Knowledge["type"]>(["logs", "source-code"]);
/** The classes of the tests a design counts towards those it must give. */
/** The levels of the pyramid of tests a plan is asked for when the caller names none. */
const DEFAULT_LEVELS: readonly ScenarioLevel[] = ["smoke", "functional", "business"];
const COUNTED = new Set<TestClass>(["passed", "failing-application"]);

/** Accepts every plan as it is: the designer works on its own. */
const ACCEPT_EVERY_PLAN: PlanReview = { review: async () => ({ accepted: true }) };

/**
 * The designer: from a brief and the domain index of the test repository, it plans then writes the
 * Playwright tests the brief needs on a new local branch, with the state of the design.
 *
 * @remarks
 * Before any session, the index must be readable, and the test repository must be the root of a git
 * repository with no tracked file changed and no untracked file outside the folders of the state and the index —
 * the configuration file, which the console rewrites, excepted — and no branch of the name to create; otherwise
 * nothing is written. A design that goes on with the branch of an earlier one needs that branch instead, which it checks out first, and commits its tests on it.
 *
 * A plan may hold no scenario, when the agent says why no test can do what the brief asks: the design then
 * writes its plan and its state, no test, and succeeds.
 *
 * A design runs in several sessions, each with its own tools, watches, browser and limits of the configured
 * autonomy. The first plans: the agent gets the brief and what the index holds for it, or the domains of
 * the index when nothing of it echoes the brief, not the index whole, which it explores by levels with
 * `knowledge_domain`, `knowledge_list` and `knowledge_read`; the browser tools of the applications, the tools of every knowledge source of the
 * environment — the bases read only — and the notes. It submits the scenarios of a test plan with
 * `propose_plan`, in as many calls as the harness asks for what is left to cover, each step
 * citing the actions of its exploration that did it: the harness writes in the plan the lines of code of
 * those actions and the element the screens showed each expected text in. `planReview` accepts or refuses
 * the plan; refused, the design stops and no test is written; accepted, the session is over, and its tools
 * refuse every later call.
 *
 * Each scenario of the plan is then written in a session of its own, in order, which is given the sheet of
 * the scenario and nothing else of the plan, nor anything the session that planned saw: the agent runs the
 * test with `run_test`, through `runner`, against the application, then closes the scenario with
 * `propose_test`, every run counting against the limits of the session. The test of a scenario is kept with
 * the text of its last run: as passed, or as failing with the cause the agent gives; its verdict is the
 * harness's. No test is lost: a scenario whose session ends before the agent closed it keeps its last file,
 * classed as unfinished. Once the sessions are over, the tests, in the folder of their application, the
 * design state, which classes each of them, and the file of the plan are committed on a new branch from the
 * revision checked out, which stays checked out. Nothing contacts a remote. A design succeeds once each
 * scenario of its plan has a test that passed or that fails because of the application, those classed as
 * duplicates set apart; with fewer, those kept are still written and the design fails.
 *
 * The plan accepted is written with the state, to a file the state names: a page a person reads, then the
 * record the harness reads again. A limit that cuts the session of a scenario while it is open stops the
 * design, which keeps its plan, even without a test, and its tests in its state. Resumed from that state
 * and that file, it checks out its branch, plans nothing, writes each scenario not closed in a session of
 * its own, from the first of them, and commits the tests it adds on the same branch, with the state updated.
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
   * @throws Error when a session cannot be opened, a file cannot be written, or git refuses the branch or the commit.
   */
  public async run(): Promise<DesignOutcome> {
    const { config, repositoryRoot, env } = this.options;
    // The trace opens with the session: a design stopped before it writes nothing to the test repository.
    let trace: Trace | undefined;
    const traced = () => (trace === undefined ? {} : { tracePath: trace.path });
    let phase: TracePhase = "plan";
    const journal = new Journal((entry) => trace?.harness(phase, { type: "journal", level: entry.level, message: entry.message }));
    const failed = (message: string, stoppedBy?: StopReason["limit"]): DesignOutcome => {
      journal.record("error", message);
      return { ok: false, tests: [], journal: journal.entries(), ...traced(), ...(stoppedBy === undefined ? {} : { stoppedBy }) };
    };
    const unstarted = (message: string): DesignOutcome => ({ ...failed(message), unstarted: true });
    const now = this.options.now ?? (() => new Date());
    const start = now();
    const id = `design-${start.toISOString().replace(/[-:]|\.\d+/g, "")}`;
    const repository = new TestRepository(repositoryRoot);
    const { continuedBranch } = this.options;
    const branch = continuedBranch ?? this.options.branch ?? `${BRANCH_PREFIX}${id}`;
    // The console writes the configuration file when a person saves a revision: that change is not the developer's.
    const reserved = [config.repository.stateDir, config.repository.indexDir, CONFIG_FILE_NAME];
    const problems = await repository.problems(branch, reserved, continuedBranch !== undefined);
    for (const problem of problems) journal.record("error", problem);
    if (problems.length > 0) return unstarted("No branch was created and no file was written.");
    if (continuedBranch !== undefined && (await repository.branch()) !== continuedBranch) await repository.switchTo(continuedBranch);
    const { brief } = this.options;
    const index = await this.index();
    if (typeof index === "string") return unstarted(`No test was designed: ${index}`);

    const applications = config.applications.filter((application) => application.environments.some((environment) => environment.name === index.environment));
    const packages = testPackages(await readFile(join(repositoryRoot, "package.json"), "utf8").catch(() => undefined));
    const readable = config.knowledge.filter((source) => source.attachments.some((a) => a.environment === undefined || a.environment === index.environment));
    // The sources a scenario may cite and a tool may belong to: the index is a map, not a limit.
    const owners = [
      ...new Set([...index.sources.map((source) => source.id), ...readable.map((source) => source.id), ...applications.map((application) => application.id)]),
    ];
    const scope = { config, repositoryRoot, env, environment: index.environment, applications, sources: readable, start, browser: this.options.browser };
    const opened = runTrace(this.options, `design-${index.environment}`, now);
    trace = opened;
    const phases = new TracedPhases(opened, "plan");
    const used = { iterations: 0, actions: 0, durationMs: 0 };
    /**
     * Runs one session of the design as a phase of its trace, under limits of its own, and gives how it ended.
     * The phase ends as done when the session ended with what it was for, as `settled` tells. The session hears the
     * person while `listening` tells it may still act on what they say; as long as it is open by default.
     */
    const sessionOf = async (
      name: "plan" | "write",
      session: SessionTools,
      task: Pick<AgentTask, "instructions" | "tools" | "request" | "reminder">,
      settled: () => boolean,
      listening?: () => boolean,
    ): Promise<TerminalEvent> => {
      phases.start(name);
      const events: AgentEvent[] = [];
      const sent = (text: string) => opened.harness(name, { type: "message", text });
      const received = (event: AgentEvent) => {
        opened.agent(name, event);
        if (event.type === "tool-error") journal.record("error", `${event.tool}: ${event.message}`);
      };
      // A session of its own leads the design while it is open: the person speaks to it, never to a session that reviews for it.
      const { inbox } = this.options;
      const person =
        inbox === undefined
          ? {}
          : { person: new PersonDelivery(inbox, ({ number, text }) => opened.harness(name, { type: "person", message: number, text }), listening) };
      const whole = { ...task, events, sent, received, ...person };
      await runAgentTask(this.options.runtime, whole, taskLimits(config)).finally(() => session.close());
      const { last, counters } = taskEnd(events);
      used.iterations += counters.iterations;
      used.actions += counters.actions;
      used.durationMs += Math.round(counters.elapsedMs);
      if (last.type === "error") journal.record("error", `The session failed: ${last.error.message}`);
      if (last.type === "stopped") journal.record("error", `The task reached its ${last.reason.limit} limit; no test was written for the scenario under way.`);
      opened.harness(name, { type: "usage", ...usageOf(counters) });
      phases.end(last.type === "stopped" ? "truncated" : last.type === "end" && settled() ? "done" : "failed");
      return last;
    };
    /** Runs one session of the agent that reviews the plan, under the limits of a task: its lines of the trace are those of `review`, and what it used is added to the design. */
    const reviewed = async (task: Pick<AgentTask, "instructions" | "tools" | "request" | "reminder">): Promise<TerminalEvent> => {
      const events: AgentEvent[] = [];
      const sent = (text: string) => opened.harness("review", { type: "message", text });
      await runAgentTask(this.options.runtime, { ...task, events, sent, received: (event) => opened.agent("review", event) }, taskLimits(config));
      const { last, counters } = taskEnd(events);
      used.iterations += counters.iterations;
      used.actions += counters.actions;
      used.durationMs += Math.round(counters.elapsedMs);
      opened.harness("review", { type: "usage", ...usageOf(counters) });
      return last;
    };
    // The fixtures and the page objects written for this design are put back as they were unless its tests are committed with them.
    const written = new WrittenFiles(repositoryRoot);
    let committed = false;
    // A session that throws leaves its phase ended as failed.
    try {
      const session = sessionTools(scope);
      const levels = this.options.levels ?? DEFAULT_LEVELS;
      // What the repository already tests: the agent that plans reads it, and a scenario one of these tests covers is set aside.
      const present = await existingTests(repositoryRoot, config.repository.appsDir);
      const paths = present.map((test) => test.path);
      const existing = await coveringTests(repositoryRoot, config.repository.stateDir, paths);
      // A brief that asks to fix tests the repository has is a repair, which the agent asks for instead of a plan.
      const repairs = new TestRepairs(await plannedTests(repositoryRoot, config.repository.stateDir, paths), paths, () => plan.drafted, journal);
      const plan = new PlanProposal(
        {
          sources: owners,
          applications: applications.map((application) => application.id),
          domains: index.domains.map((domain) => domain.id),
          levels,
          secrets: declaredSecrets(config, env),
          addresses: declaredAddresses(config),
          screens: session.screens,
          reads: session.reads,
          review: this.options.planReview ?? ACCEPT_EVERY_PLAN,
          ...(this.options.reviewPlan === true ? { judge: new PlanReviewer(reviewed) } : {}),
          existing,
          ...(this.options.visual === true ? { visual: true, uncompared: uncomparedScreens(existing) } : {}),
          now,
        },
        journal,
      );
      const offered = [...session.screens.tools(), ...session.reads.tools()];
      const map = new IndexMap(index, await this.cards(index), offered, owners, await this.written(index));
      const request = planRequest(brief, index.environment, map.domains(), applications, levels, this.options.visual === true);
      const notes = agentNotes(config, repositoryRoot, env, { role: "planner", task: id, now });
      const tools = [...map.toolset(), ...existingTestTools(present), ...offered, ...notes, repairs.tool(), plan.tool()].map((tool) =>
        endedWithPlan(tool, plan, repairs),
      );
      // What the plan says of each scenario, its title and its steps, is what its test says: it is written in the language of the tests.
      const testLanguage = testLanguageRule(config.design.testLanguage);
      const reminder = () => (repairs.chosen === undefined ? plan.reminder() : undefined);
      const task = { instructions: `${PLANNER_INSTRUCTIONS}\n\n${testLanguage}`, tools, request, reminder };
      // Once its plan is accepted or refused, or a repair asked, the session that plans can act on nothing: a message then waits for the agent that writes.
      const open = () => plan.accepted === undefined && plan.refused === undefined && repairs.chosen === undefined;
      const settled = () => plan.accepted !== undefined || plan.drafted || repairs.chosen !== undefined;
      const last = await sessionOf("plan", session, task, settled, open);
      // A session that ends once scenarios are kept closes the plan with them: none is lost.
      await plan.close();
      if (plan.refused !== undefined) return failed(`No test was written: the plan was refused: ${plan.refused}`);
      // The scenarios of a repair are those of the plans that wrote its tests, as they were accepted then.
      const repairing = repairs.chosen;
      const accepted = repairing === undefined ? plan.accepted : { scenarios: repairing.map((repair) => repair.scenario) };
      if (accepted === undefined)
        return failed(
          `No test was written: ${obtained(0)}, one per scenario of the plan is expected.`,
          last.type === "stopped" ? last.reason.limit : undefined,
        );
      // The visual scenarios the agent planned end with the comparison of their screen with its reference.
      let planned: TestPlan =
        repairing === undefined ? { ...accepted, scenarios: withComparisons(accepted.scenarios, config.design.visualTolerance) } : accepted;
      // The agents that write and review code read the API of Playwright at the version the test repository installs.
      const playwright = playwrightTools(await PlaywrightReference.load(repositoryRoot));
      // How the tests are built is a matter of the configuration. Unless each test stands alone, they import their test from the
      // fixtures the repository shares, written now when it has none: they give each application that has a user interface.
      const { architecture, fixturesFile } = config.design;
      const { appsDir } = config.repository;
      const screened = config.applications.filter((application) => application.type !== "api").map((application) => application.id);
      const fixtures = architecture === "standalone" ? undefined : await ensureFixtures(repositoryRoot, fixturesFile, appsDir, screened, written);
      // The fixtures hold the page objects of each application: with them, each action of the plan on an element of a screen acts on
      // the page object of that screen, added to as needed.
      const given = config.applications.filter((application) => fixtures?.applications.includes(application.id));
      const pages = new PageObjects({ repositoryRoot, appsDir, applications: given });
      if (architecture === "page-objects" && repairing === undefined) planned = { ...planned, scenarios: await pages.apply(planned.scenarios) };
      for (const file of await pages.files()) await written.write(file.path, file.content);
      const proposals = new TestProposals(
        {
          repositoryRoot,
          appsDir: config.repository.appsDir,
          addresses: declaredAddresses(config),
          secrets: declaredSecrets(config, env),
          ...(this.options.check === undefined ? {} : { check: this.options.check }),
          ...(this.options.reviewTests === true ? { coherence: new CoherenceReviewer(reviewed) } : {}),
          ...(this.options.reviewCode === true && this.options.reviewerInstructions !== undefined
            ? { quality: new CodeReviewer(reviewed, this.options.reviewerInstructions, playwright) }
            : {}),
          runner: this.options.runner,
          packages,
          ...(fixtures === undefined ? {} : { fixtures }),
          screenshots: this.options.screenshots ?? false,
          now,
          ...(repairing === undefined ? {} : { repairs: new Map(repairing.map((repair) => [repair.scenario.id, repair.path])) }),
        },
        journal,
        planned,
      );
      // Each scenario not closed is written in a session of its own, which is given its sheet and nothing else of the plan.
      const recall = agentRecall(config, repositoryRoot, env, { role: "writer", task: id, now });
      let stoppedBy: StopReason["limit"] | undefined;
      for (let scenario = proposals.scenario; scenario !== undefined; scenario = proposals.scenario) {
        // The session has the screens of the applications its scenario acts on, the sources the scenario cites, and those that tell why a run failed.
        const { application: about, sources: cites } = scenario;
        const cited = readable.filter((source) => INSPECTED.has(source.type) || cites.some((reference) => reference.source === source.id));
        const session = sessionTools({
          ...scope,
          applications: applications.filter((application) => [about, ...(scenario.applications ?? [])].includes(application.id)),
          sources: cited,
        });
        const sheet = proposals.sheet!;
        // The journal of the scenario belongs to the phase of its session.
        phase = "write";
        proposals.begin(session);
        const beyond = new SheetWatch(scenario, () => proposals.failedSoFar, journal);
        const looking = beyond.watched([...session.screens.tools(), ...session.reads.tools()]);
        const tools = [...looking, ...recall, ...playwright, proposals.trialTool(), proposals.tool()];
        const request = writeRequest(
          sheet,
          applications.find((application) => application.id === about)!,
          // Playwright itself is imported through the fixtures of the repository, when its tests share some.
          fixtures === undefined ? packages : [fixtures.path, ...packages.filter((name) => name !== TEST_MODULE)],
          index.environment,
          repairedTest(repairing, scenario.id, present),
        );
        const task = { instructions: `${this.options.writerInstructions}\n\n${testLanguage}`, tools, request, reminder: () => proposals.reminder() };
        const last = await sessionOf("write", session, task, () => !proposals.writing);
        beyond.close();
        // A limit that cuts a scenario short stops the design; so does a session that failed.
        if (last.type === "stopped" && proposals.writing) stoppedBy = last.reason.limit;
        if (last.type === "error" || stoppedBy !== undefined) break;
        if (proposals.writing) proposals.giveUp(SESSION_END);
      }
      const tests = proposals.accepted;
      const kept = tests.map(({ content: _content, references, ...test }) => ({
        ...test,
        ...(references.length === 0 ? {} : { references: references.map((reference) => reference.path) }),
      }));
      // A plan without a scenario says why no test can do what the brief asks: it is kept, and there is nothing to write.
      if (planned.scenarios.length === 0)
        journal.record("info", "No test was written: the plan holds no scenario, and says what the brief asks that no test can do.");
      else if (kept.length === 0 && stoppedBy === undefined) return failed(`No test was written: ${obtained(0)}, one per scenario of the plan is expected.`);
      const record: PlanRecord = {
        formatVersion: 2,
        design: id,
        environment: index.environment,
        ...(brief === undefined ? {} : { brief }),
        // The scenarios, why the harness asked for no more, those set aside, and what the plan leaves out.
        ...planned,
      };
      const state: DesignState = {
        formatVersion: 4,
        producedAt: start.toISOString(),
        environment: index.environment,
        ...(brief === undefined ? {} : { brief }),
        plan: posix.join(config.repository.stateDir, DESIGNS_FOLDER, `${id}${PLAN_FILE_SUFFIX}`),
        branch,
        // A branch still to create starts from the revision checked out now.
        base: await repository.head(),
        model: { provider: config.model.provider, baseUrl: config.model.baseUrl, model: config.model.model },
        run: used,
        tests: kept,
      };
      const statePath = posix.join(config.repository.stateDir, DESIGNS_FOLDER, `${id}.json`);
      await this.write(repository, state, statePath, record, tests, written.paths, journal);
      committed = tests.length > 0;
      const counted = kept.filter((test) => COUNTED.has(test.classes.at(-1)!.class)).length;
      // The count of the harness: each scenario of the plan is accounted for — by a test that counts, by another test that already
      // verifies it, or by the reason the agent that writes gave for which no test can do it. Nothing else closes a design.
      const classed = (name: TestClass) => kept.filter((test) => test.classes.at(-1)!.class === name);
      const unfeasible = classed("unfeasible");
      if (unfeasible.length > 0)
        journal.record(
          "info",
          `Scenarios of the plan without a test, the agent that writes having said why (${unfeasible.length} of ${record.scenarios.length}): ${unfeasible.map((test) => `${test.scenario} (${test.classes.at(-1)!.reason})`).join("; ")}`,
        );
      const expected = record.scenarios.length - classed("duplicate").length - unfeasible.length;
      if (counted < expected)
        journal.record(
          "error",
          `The design failed: ${obtained(counted)}, ${expected} ${expected === 1 ? "is" : "are"} expected, one per scenario of the plan.`,
        );
      return {
        ok: counted >= expected,
        ...(kept.length === 0 ? {} : { branch }),
        statePath: join(repositoryRoot, statePath),
        planPath: join(repositoryRoot, state.plan),
        uncovered: record.uncovered ?? [],
        tests: kept,
        journal: journal.entries(),
        tracePath: opened.path,
        ...(stoppedBy === undefined ? {} : { stoppedBy }),
        ...(repairing === undefined ? {} : { repaired: true }),
      };
    } finally {
      phases.close();
      // What was written for tests that were not committed is no one's: the next design writes it again.
      if (!committed) await written.revert();
    }
  }

  /**
   * Writes the state, the file of its plan and the new tests and, with a test at least, commits them on the branch, created if need be,
   * with the files written for them before.
   */
  private async write(
    repository: TestRepository,
    state: DesignState,
    statePath: string,
    plan: PlanRecord,
    tests: readonly AcceptedTest[],
    shared: readonly string[],
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
    const line = (test: AcceptedTest) => {
      if (test.duplicates !== undefined) return `- ${test.path}: duplicate of ${test.duplicates}`;
      if (test.quarantine !== undefined) return `- ${test.path}: failing (${test.quarantine.cause})${stepOf(test.quarantine.failedStep)}`;
      return test.classes.at(-1)!.class === "unfinished" ? `- ${test.path}: unfinished (${test.closedBy})` : `- ${test.path}: ${titles.get(test.scenario)}`;
    };
    const message = [`test: add ${tests.length} generated Playwright tests`, "", ...tests.map(line)].join("\n");
    const committed = new Set(await repository.commit([...files.map(([path]) => path), ...shared], message));
    for (const test of tests) journal.record("info", `The test ${test.path} was written.`);
    const ignored = (path: string) => (committed.has(path) ? "" : ", which git ignores: it was not committed");
    journal.record("info", `The plan was written to ${state.plan}${ignored(state.plan)}.`);
    journal.record("info", `The design state was written to ${statePath}${ignored(statePath)}.`);
    journal.record("info", `The tests were committed on ${state.branch}; the active branch of the test repository is ${await repository.branch()}.`);
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

  /** What the workflow of each source of the index wrote beside its card, for those whose manifest can be read: the file of each domain, and its export. */
  private async written(index: DomainIndex): Promise<Map<string, WrittenSource>> {
    const cards = join(this.options.repositoryRoot, this.options.config.repository.indexDir, CARDS_FOLDER);
    const read = await Promise.all(
      index.sources.map(async (source) => {
        const folder = join(cards, source.id);
        const validation = validateSourceManifest(await readJson(join(folder, MANIFEST_FILE)));
        if (!validation.ok) return [];
        const manifest = validation.value;
        const files = await Promise.all(
          manifest.domains.map(async (domain) => {
            const text = domain.file === undefined ? undefined : await readText(join(folder, domain.file));
            return text === undefined ? [] : [[domain.id, text] as const];
          }),
        );
        // A file of the manifest is one the harness wrote in the folder of the source.
        const written: WrittenSource = { manifest, files: new Map(files.flat()), read: (file) => readText(join(folder, file)) };
        return [[source.id, written] as const];
      }),
    );
    return new Map(read.flat());
  }
}

/** A text file, or `undefined` when it cannot be read. */
async function readText(path: string): Promise<string | undefined> {
  return readFile(path, "utf8").catch(() => undefined);
}

/** A tool that refuses every call once the plan is refused, the design being stopped, or accepted or a repair asked, the session that plans being over. */
function endedWithPlan(tool: ToolDefinition, plan: PlanProposal, repairs: TestRepairs): ToolDefinition {
  const ended = () =>
    plan.refused !== undefined ? plan.blocked() : plan.accepted !== undefined ? plan.closed() : repairs.chosen !== undefined ? repairs.closed() : undefined;
  return {
    ...tool,
    execute: async (args) => {
      const told = ended();
      return told === undefined ? tool.execute(args) : { error: told };
    },
  };
}

/** The test the session of a scenario repairs, with its text now; none for a scenario of a plan. */
function repairedTest(repairing: readonly TestRepair[] | undefined, scenario: string, present: readonly ExistingTest[]): RepairedTest | undefined {
  const path = repairing?.find((repair) => repair.scenario.id === scenario)?.path;
  const test = present.find((candidate) => candidate.path === path);
  return test === undefined ? undefined : { path: test.path, content: test.content };
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
