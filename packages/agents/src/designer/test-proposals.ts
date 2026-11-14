import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import type { PlannedScenario, TestPlan, ToolDefinition } from "@open-qa-stack/domain";
import { moduleSyntax, redactText, scopedToolName, secretForms, type SpecLocator } from "@open-qa-stack/tools";
import type { Journal } from "../common/journal.ts";
import { DesignCursor, MAX_FAILED_RUNS, type ScenarioRun } from "./design-cursor.ts";
import { assertionAt, failurePageText, misplacedAtFailure, shownAtFailure } from "./failure-page.ts";
import { errorClass, failureHint } from "./run-failure.ts";
import type { DesignedRun, DesignedTest, FailureCause, Quarantine, TestClassing } from "./design-state.ts";
import { journalRefusals, maskedRefusals, refusalText, repeatedText, type Refusal } from "./refusal.ts";
import { GUIDED_REFUSALS, MAX_REFUSALS, RefusalStreak } from "./refusal-streak.ts";
import { scenarioErrors } from "./scenario-gates.ts";
import { scenarioSheet, skeleton } from "./scenario-sheet.ts";
import { snapshotLines, type ScreenWatch } from "./screen-watch.ts";
import type { SourceWatch } from "./source-watch.ts";
import type { TestCheck, TestFinding, TestReference, TestRunner, TestTrial, Verdict } from "@open-qa-stack/domain";
import { addressErrors, fileErrors, heldVariables, importErrors, locatorsOf, secretValueErrors, type DeclaredSecret } from "./spec-rules.ts";

/** Name of the tool the designer closes a scenario with. */
export const PROPOSE_TOOL = "propose_test";
/** Name of the tool the designer runs the test of a scenario with. */
export const RUN_TOOL = "run_test";
/** The check that closes a scenario whose session ended before the agent closed it. */
export const SESSION_END = "SESSION-END";
/** How what the agent is told of a scenario that is closed ends: its session is over. */
const SESSION_OVER = "Next: answer with one sentence. Call no more tools.";
/** Longest error told to the agent for a test that did not pass. */
const MAX_TOLD_ERROR = 1500;
/** Fewest tests a design must give. */
export const MIN_TESTS = 3;
/** Most tests a design writes: the most scenarios a plan holds. */
export const MAX_TESTS = 4;

/** A test accepted, with its text. */
export interface AcceptedTest extends Omit<DesignedTest, "references"> {
  /** Text of the file. */
  readonly content: string;
  /** The references of its visual comparisons, made at its run, to write with it. */
  readonly references: readonly TestReference[];
}

/** What the tests are checked against. */
export interface ProposalRules {
  /** Absolute path of the test repository. */
  readonly repositoryRoot: string;
  /** Folder of the applications, relative to the root of the test repository. */
  readonly appsDir: string;
  /** The addresses no test may hold, as `declaredAddresses` gives them. */
  readonly addresses: readonly string[];
  /** The values no test nor diagnosis may hold, masked in every refusal. */
  readonly secrets: readonly DeclaredSecret[];
  /** The check run on a test the harness found nothing to refuse in, if any. */
  readonly check?: TestCheck;
  /** Runs a test file against the application: every test is run before it is kept. */
  readonly runner: TestRunner;
  /** The packages a test may import, as `testPackages` gives them. */
  readonly packages: readonly string[];
  /** Whether each step of a test ends with a screenshot attached to the report, as the charter may ask. */
  readonly screenshots: boolean;
  /** The clock of the dates a test is classed at. */
  readonly now: () => Date;
}

/** What the agent sees and reads in the session that writes the test of one scenario. */
export interface WritingSession {
  /** What the agent saw of the screens in this session, which a locator of its own must rely on. */
  readonly screens: ScreenWatch;
  /** What the agent read of the knowledge sources in this session, which may be a look at what a failed run did. */
  readonly reads: SourceWatch;
}

/** What the agent says of a test whose last run failed. */
interface Diagnosis {
  readonly cause: FailureCause;
  readonly evidence: string;
}

/**
 * The tests of the scenarios of an accepted plan, written one scenario at a time, in the order of the plan.
 *
 * @remarks
 * A cursor opens the first scenario of the plan not closed, and names the file of its test. Each scenario is
 * written in a session of its own, which `begin` binds to it: until then, and once the scenario is closed,
 * `run_test` and `propose_test` are refused with `SCENARIO-CLOSED`. `run_test`
 * takes the whole text of that file, checks it, and runs it against the application. A text is refused,
 * with every reason of the first tier that refuses it and its code:
 *
 * 1. the repair: the scenario already failed three runs, this very text already failed, or the agent did
 *    not look at the application since the last failed run;
 * 2. the text: it does not parse as TypeScript, imports anything but the packages of the test repository or
 *    a relative path inside it, imports another test, writes a file, holds an address of the configuration
 *    or the value of a declared variable;
 * 3. the scenario: not one test, not the steps of the plan, a step that does nothing on the application, a planned text not asserted or asserted the
 *    other way round, an assertion that can only pass, a value typed that is none of the data, a locator that
 *    is none of the skeleton of the scenario and that no screen showed;
 * 4. the check given, when it finds something.
 *
 * `propose_test` closes the scenario open with the text of its last run that gave a verdict: passed, it is
 * kept as passed; failed, it is kept unchanged, as failing, with the cause and the evidence the agent gives;
 * a cause other than `test` is refused for a run that stopped before any assertion, or whose assertion found
 * no element though the page at the failure showed, beside the fields, each text the step expects that it
 * looked for, and none the step expects gone. The agent is told, after a
 * failed run, what that page showed of those texts, and its lines count as lines the screens showed.
 * The verdict is the harness's, never the agent's. The calls run one at a time, each seeing the runs the
 * previous recorded. Every refusal is journaled with its code and told to the agent, every declared value
 * masked. From the third refusal of one reason since the test last ran, the agent is told only what the
 * gate would accept; the fifth closes the scenario: with the text of its last run that gave a verdict,
 * kept as it ended, a failing one with the cause `test`.
 *
 * No test is lost. A scenario closed before its test was made to end — by the fifth refusal with no run that
 * gave a verdict, by three runs without a verdict, or by `giveUp` when its session ended first — keeps a
 * file classed `unfinished`: the last text submitted that held nothing a test may not hold, or the skeleton
 * when none was, with why it was closed and what was tried. Each test kept is classed, with the date, who
 * classed it and why.
 */
export class TestProposals {
  private readonly rules: ProposalRules;
  private readonly journal: Journal;
  private readonly kept: AcceptedTest[] = [];
  private readonly forms: readonly string[];
  private readonly cursor: DesignCursor;
  /** The session that writes the scenario open; none before `begin`, and once the scenario is closed. */
  private session: WritingSession | undefined;
  /** The last text submitted for the scenario open that held nothing a test may not hold. */
  private submitted: string | undefined;
  /** The codes that refused a call about the scenario open, in order. */
  private refusedCodes: string[] = [];
  /** The refusals of the calls about the scenario open since its test last ran. */
  private readonly streak = new RefusalStreak();
  /** The references a run made, by the text that ran. */
  private readonly references = new Map<string, readonly TestReference[]>();
  /** The calls that run or close a test, one after the other. */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * @param rules - What the tests are checked against.
   * @param journal - Where refusals, runs and the scenarios closed are written.
   * @param plan - The accepted plan.
   * @param closed - How many scenarios, from the first, an earlier design closed; none by default, and fewer than the plan holds.
   */
  public constructor(rules: ProposalRules, journal: Journal, plan: TestPlan, closed = 0) {
    this.rules = rules;
    this.journal = journal;
    this.forms = rules.secrets.flatMap((secret) => secretForms(secret.value));
    this.cursor = new DesignCursor(plan, (scenario) => this.place(scenario), closed);
  }

  /**
   * The tests accepted so far.
   *
   * @returns A copy, in the order of the plan.
   */
  public get accepted(): AcceptedTest[] {
    return [...this.kept];
  }

  /**
   * The sheet of the first scenario not closed, which the session that writes it starts from.
   *
   * @returns The sheet; `undefined` once every scenario is closed.
   */
  public get sheet(): string | undefined {
    return this.cursor.scenario === undefined ? undefined : scenarioSheet(this.cursor, this.rules.screenshots);
  }

  /**
   * Whether a session is writing the scenario open.
   *
   * @returns `true` from `begin` until the scenario is closed.
   */
  public get writing(): boolean {
    return this.session !== undefined;
  }

  /**
   * Binds a session to the first scenario not closed: its test is written with what this session sees and reads.
   *
   * @param session - What the agent sees of the screens and reads of the sources in the session.
   */
  public begin(session: WritingSession): void {
    this.session = session;
    this.submitted = undefined;
    this.refusedCodes = [];
    this.streak.reset();
    this.journal.record("info", `The scenario ${this.cursor.scenario!.id} was opened; its test is ${this.cursor.path}.`);
  }

  /**
   * Closes the scenario a session was writing when the session ended before the agent closed it: its test is
   * kept as passed when its last run passed, and as unfinished otherwise.
   *
   * @param check - The check that closes it, such as `SESSION_END`.
   */
  public giveUp(check: string): void {
    const open = { cursor: this.cursor, scenario: this.cursor.scenario!, path: this.cursor.path! };
    const last = open.cursor.runs.at(-1);
    if (last?.verdict === "passed") {
      const reason = "Its last run passed; its session ended before the agent closed the scenario.";
      this.keep(open, last, undefined, { class: "passed", origin: { by: "harness", check }, reason }, check);
      this.journal.record("info", `The scenario ${open.scenario.id} was closed by the harness (${check}): passed; its test is ${open.path}.`);
    } else this.unfinished(open, check, "Its session ended before the scenario was closed.");
    this.next(open.cursor, "");
  }

  /**
   * The tool the agent runs the test of the scenario open with.
   *
   * @returns The tool.
   */
  public trialTool(): ToolDefinition {
    return {
      name: RUN_TOOL,
      description: `Checks the test of the open scenario against the plan, then runs it against the application with the real runner. Give the whole file: one test, one test.step per step of the plan, as in the skeleton. Returns the verdict, the error, the step that failed and what to look at. After a failed run you may fix a locator or a wait; the expected texts of the plan stay. A scenario has ${MAX_FAILED_RUNS} failed runs at most.`,
      parameters: {
        type: "object",
        properties: { content: { type: "string", minLength: 1, description: "The whole text of the file, in TypeScript." } },
        required: ["content"],
        additionalProperties: false,
      },
      execute: async (args) => this.serial(() => this.tryTest((args as { content: string }).content)),
    };
  }

  /**
   * The tool the agent closes the scenario open with.
   *
   * @returns The tool.
   */
  public tool(): ToolDefinition {
    return {
      name: PROPOSE_TOOL,
      description:
        "Closes the open scenario with the test of its last run. A test that passed is kept. A test that failed is kept as failing, with your diagnosis, for a person to decide; it is never changed to pass.",
      parameters: {
        type: "object",
        properties: {
          diagnosis: {
            type: "object",
            properties: {
              cause: {
                type: "string",
                enum: ["application", "plan", "test"],
                description:
                  "application: the run failed on an assertion, and the application does not do what the plan expects. plan: the run failed on an assertion, and an expected text of the plan is wrong. test: the test could not be made to work.",
              },
              evidence: { type: "string", minLength: 1, description: "What the run showed and what you checked: expected, received, the screen, the logs." },
            },
            required: ["cause", "evidence"],
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      execute: async (args) => this.serial(async () => this.propose((args as { diagnosis?: Diagnosis }).diagnosis)),
    };
  }

  /**
   * The message that reminds an agent which stopped before every scenario was closed.
   *
   * @returns The reminder; `undefined` when no session is writing a scenario.
   */
  public reminder(): string | undefined {
    if (this.session === undefined) return undefined;
    const cursor = this.cursor;
    const scenario = cursor.scenario!;
    const last = cursor.runs.at(-1);
    const where = `Scenario ${cursor.rank} of ${cursor.plan.scenarios.length}, ${scenario.id}`;
    const state =
      last === undefined
        ? "its test has not run"
        : last.verdict === "passed"
          ? "its test passed and is not closed"
          : `its last run failed (${cursor.failedRuns} of ${MAX_FAILED_RUNS})`;
    this.journal.record("info", `The agent stopped before scenario ${scenario.id} was closed; it was reminded to go on.`);
    return `You stopped before the end. ${where}: ${state}.\n${cursor.next()}`;
  }

  /** Runs a call once the calls before it are done, whatever they gave. */
  private serial<T>(call: () => Promise<T>): Promise<T> {
    const done = this.queue.then(call);
    this.queue = done.catch(() => undefined);
    return done;
  }

  /** How many times the agent looked at an application: its screens and the logs or the code, or any source when it has no screens. */
  private looks(application: string): number {
    const { screens, reads } = this.session!;
    return screens.watches(application) ? screens.looks(application) + reads.looks() : reads.calls();
  }

  /** Checks the test of the scenario open, runs it, and tells the agent what the run gave. */
  private async tryTest(content: string): Promise<string | { error: string }> {
    const open = this.open();
    if ("error" in open) return open;
    const { cursor, scenario, path } = open;
    const what = `The test ${path} could not be run`;
    const repair = this.repairErrors(cursor, scenario, content);
    if (repair.length > 0) return this.refuse(what, repair);
    const refusals = await this.checked(scenario, path, content);
    if (refusals.length > 0) return this.refuse(what, refusals);
    const looks = this.looks(scenario.application);
    const trial = await this.rules.runner.run({ path, content });
    this.streak.reset();
    if (trial.error !== undefined) {
      cursor.record(scenario.id, { content, startedAt: trial.startedAt, looks });
      this.journal.record("error", this.mask(`The test ${path} could not run: ${trial.error}`));
      return this.mask([`Run of the file: it could not run: ${trial.error}`, this.failedRuns(cursor, scenario), cursor.next()].join("\n"));
    }
    const verdict = verdictOf(trial);
    const failed = trial.tests.find((test) => test.verdict !== "passed");
    // The page at the failure is one the screens showed: a test may find an element of it.
    const page = failed?.page === undefined ? undefined : snapshotLines(failed.page);
    if (page !== undefined) this.session!.screens.recordPage(scenario.application, page);
    const failure =
      failed === undefined
        ? {}
        : {
            errorClass: errorClass(failed.reason),
            ...(failed.failedStep === undefined ? {} : { failedStep: failed.failedStep }),
            ...(page === undefined ? {} : { page, reason: failed.reason }),
          };
    cursor.record(scenario.id, { content, verdict, ...failure, startedAt: trial.startedAt, looks });
    this.references.set(content, trial.references ?? []);
    this.journal.record("info", `The test ${path} was run: ${verdict}.`);
    const shown = page === undefined ? [] : failurePageText(shownAtFailure(scenario, failed!.failedStep, page));
    const told =
      failed === undefined
        ? []
        : [this.mask(failureHint(failed.reason, scenario.application)), ...shown.map((line) => this.mask(line)), this.failedRuns(cursor, scenario)];
    return [this.described(trial), ...told, cursor.next()].join("\n");
  }

  /** What the repair contract refuses in a run: a scenario out of runs, a text that already failed, a run again without a look. */
  private repairErrors(cursor: DesignCursor, scenario: PlannedScenario, content: string): Refusal[] {
    const refusals: Refusal[] = [];
    const failed = cursor.failedRuns;
    if (failed >= MAX_FAILED_RUNS) {
      refusals.push({
        code: "TEST-STOP",
        message: `scenario ${scenario.id} failed ${failed} runs. Do not run it again. Call ${PROPOSE_TOOL} with diagnosis: the cause, and what the last run showed. The test is kept as failing, for a person to decide.`,
      });
    }
    if (cursor.runs.some((run) => run.content === content && run.verdict !== "passed")) {
      refusals.push({
        code: "TEST-SAME",
        message: `this text already failed, and nothing changed. Fix the locator or the wait the error names, or call ${PROPOSE_TOOL} with diagnosis.`,
      });
    }
    const last = cursor.runs.at(-1);
    if (last !== undefined && last.verdict !== "passed" && this.looks(scenario.application) === last.looks) {
      const look = this.lookAdvice(scenario, last);
      if (look !== undefined) refusals.push({ code: "TEST-LOOK", message: `look before you run again. ${look}` });
    }
    return refusals;
  }

  /** How to look at what a failed run did, with the tools the agent has; none when it has no tool to look with. */
  private lookAdvice(scenario: PlannedScenario, last: ScenarioRun): string | undefined {
    const { screens, reads } = this.session!;
    const step = last.failedStep === undefined ? "" : ` (${JSON.stringify(last.failedStep)})`;
    const logs = reads.firstTools("logs").map((tool) => `read the logs since ${last.startedAt} with ${tool}`);
    if (screens.watches(scenario.application))
      return [`Take ${scopedToolName(scenario.application, "snapshot")} at the step that failed${step}`, ...logs].join(", or ") + ".";
    const inspections = [...logs, ...reads.firstTools("source-code").map((tool) => `read the source code with ${tool}`)];
    if (inspections.length > 0) return `${capitalised(inspections.join(", or "))}, at the step that failed${step}.`;
    // Without screens, logs nor code, what a source holds is all there is to check the run against.
    const cited = [...new Set(scenario.sources.flatMap(({ source }) => reads.firstTool(source) ?? []))];
    const tools = cited.length === 0 ? reads.firstTools() : cited;
    return tools.length === 0 ? undefined : `Read what a source tells of the step that failed${step}, with ${tools.join(" or ")}.`;
  }

  /** The line that counts the failed runs of a scenario. */
  private failedRuns(cursor: DesignCursor, scenario: PlannedScenario): string {
    return `Failed runs of ${scenario.id}: ${cursor.failedRuns} of ${MAX_FAILED_RUNS}.`;
  }

  /** Closes the scenario open with the text of its last run that gave a verdict. */
  private propose(diagnosis: Diagnosis | undefined): string | { error: string } {
    const open = this.open();
    if ("error" in open) return open;
    const { cursor, scenario } = open;
    const last = cursor.runs.at(-1);
    const what = `The scenario ${scenario.id} could not be closed`;
    const left = cursor.failedRuns < MAX_FAILED_RUNS;
    if (last === undefined) return this.refuse(what, [{ code: "PROPOSE-RUN", message: `scenario ${scenario.id} has not run. Call ${RUN_TOOL} first.` }]);
    if (!judged(last) && left)
      return this.refuse(what, [{ code: "PROPOSE-RUN", message: `scenario ${scenario.id} has not run to a verdict. Call ${RUN_TOOL} first.` }]);
    const ended = cursor.runs.findLast(judged);
    if (ended === undefined) {
      this.unfinished(open, "TEST-STOP", `None of its ${MAX_FAILED_RUNS} runs gave a verdict.`);
      return this.next(cursor, `Scenario ${scenario.id} closed, its test kept as unfinished: none of its runs gave a verdict.`);
    }
    let quarantine: Quarantine | undefined;
    if (ended.verdict === "failed") {
      if (diagnosis === undefined)
        return this.refuse(what, [
          {
            code: "PROPOSE-DIAG",
            message: `the last run of scenario ${scenario.id} failed. Repair it with ${RUN_TOOL} (failed runs: ${cursor.failedRuns} of ${MAX_FAILED_RUNS}), or give diagnosis: the cause and what the run showed.`,
          },
        ]);
      const refusals: Refusal[] = [];
      if (diagnosis.cause === "test" && left)
        refusals.push({
          code: "PROPOSE-EARLY",
          message: `failed runs: ${cursor.failedRuns} of ${MAX_FAILED_RUNS}. Try a repair with ${RUN_TOOL} before giving up on the test itself.`,
        });
      if (diagnosis.cause !== "test" && ended.errorClass !== "assertion") {
        const step = ended.failedStep === undefined ? "" : ` at step ${JSON.stringify(ended.failedStep)}`;
        refusals.push({
          code: "PROPOSE-CAUSE",
          message: `cause "${diagnosis.cause}" does not fit: the run failed on ${ended.errorClass}${step}, before any check of the application. Fix the locator, or give cause "test".`,
        });
      }
      const misplaced = ended.page === undefined ? [] : misplacedAtFailure(scenario, ended.failedStep, ended.page, ended.reason!);
      if (diagnosis.cause !== "test" && misplaced.length > 0) {
        const where = misplaced.map(({ text, lines }) => `"${text}" in ${lines[0]}`).join(", ");
        refusals.push({
          code: "PROPOSE-CAUSE",
          message: `cause "${diagnosis.cause}" does not fit: at the failure of step ${JSON.stringify(ended.failedStep)}, the assertion found no element, and the page showed what it looked for (${where}). The application shows it, and the assertion looks for it in another element: point it at that element with ${RUN_TOOL}, such as ${assertionAt(misplaced[0]!)} Once no run is left, give cause "test".`,
        });
      }
      refusals.push(
        ...heldVariables(diagnosis.evidence, this.rules.secrets).map((variable) => ({
          code: "PROPOSE-SECRET",
          message: `the diagnosis holds the value of ${variable}. Leave it out; a test reads it with process.env.${variable}.`,
        })),
      );
      if (refusals.length > 0) return this.refuse(what, refusals);
      quarantine = quarantineOf(diagnosis.cause, diagnosis.evidence, ended);
    }
    const classing: Classed =
      quarantine === undefined
        ? { class: "passed", origin: { by: "harness", check: RUN_TOOL }, reason: "Its last run passed." }
        : { class: `failing-${quarantine.cause}`, origin: { by: "agent", role: "writer" }, reason: quarantine.evidence };
    const outcome = this.keep(open, ended, quarantine, classing);
    this.journal.record("info", `The scenario ${scenario.id} was closed: ${outcome}; its test is ${open.path}.`);
    return this.next(cursor, `Scenario ${scenario.id} closed: ${outcome}.`);
  }

  /** Keeps the test of the scenario open with the text of one of its runs, classed, and says how it ended. */
  private keep(open: Open, run: ScenarioRun, quarantine: Quarantine | undefined, classing: Classed, closedBy?: string): string {
    this.kept.push({
      path: open.path,
      scenario: open.scenario.id,
      verdict: run.verdict!,
      classes: [{ at: this.rules.now().toISOString(), ...classing }],
      runs: runsOf(open.cursor),
      ...(quarantine === undefined ? {} : { quarantine }),
      ...(closedBy === undefined ? {} : { closedBy }),
      content: run.content,
      references: this.references.get(run.content)!,
    });
    return quarantine === undefined ? "passed" : `failing (${quarantine.cause}), kept for a person to decide`;
  }

  /**
   * Keeps the test of the scenario open as unfinished: the last text submitted that held nothing a test may
   * not hold, or the skeleton when none was, with why the scenario is closed and what was tried.
   */
  private unfinished(open: Open, check: string, why: string): void {
    const content = this.submitted ?? skeleton(open.scenario, this.rules.screenshots);
    const ran = open.cursor.runs.findLast((run) => run.content === content && judged(run));
    const runs = runsOf(open.cursor);
    const refused = [...new Set(this.refusedCodes)].map((code) => `${code} ×${this.refusedCodes.filter((other) => other === code).length}`);
    const tried = [
      runs.length === 0 ? "no run" : `${runs.length} ${runs.length === 1 ? "run" : "runs"} (${runs.map(runText).join(", ")})`,
      refused.length === 0 ? "no refusal" : `refusals: ${refused.join(", ")}`,
    ].join("; ");
    this.kept.push({
      path: open.path,
      scenario: open.scenario.id,
      verdict: ran?.verdict ?? "not_run",
      classes: [{ at: this.rules.now().toISOString(), class: "unfinished", origin: { by: "harness", check }, reason: `${why} Tried: ${tried}.` }],
      runs,
      closedBy: check,
      content,
      references: this.references.get(content) ?? [],
    });
    this.journal.record("error", `The scenario ${open.scenario.id} was closed by the harness (${check}): its test is kept as unfinished: ${open.path}.`);
  }

  /** Closes the scenario open, whose session is over, and tells the agent so. */
  private next(cursor: DesignCursor, closed: string): string {
    cursor.close();
    this.session = undefined;
    return `${closed}\n${SESSION_OVER}`;
  }

  /** The scenario a session is writing and the file of its test, or why there is none. */
  private open(): Open | { error: string } {
    if (this.session === undefined)
      return {
        error: refusalText([{ code: "SCENARIO-CLOSED", message: "the scenario of this session is closed. Answer with one sentence; call no more tools." }]),
      };
    return { cursor: this.cursor, scenario: this.cursor.scenario!, path: this.cursor.path! };
  }

  /** The file of the test of a scenario: named after it, in the folder of its application, with a number when that path is taken. */
  private place(scenario: PlannedScenario): string {
    const taken = (path: string) => this.kept.some((test) => test.path === path) || existsSync(join(this.rules.repositoryRoot, path));
    const name = (rank: number) => posix.join(this.rules.appsDir, scenario.application, `${scenario.id}${rank === 1 ? "" : `-${rank}`}.spec.ts`);
    let rank = 1;
    while (taken(name(rank))) rank += 1;
    return name(rank);
  }

  /** What the gates refuse in the text of a test, by tier: the first tier that refuses gives all its reasons. */
  private async checked(scenario: PlannedScenario, path: string, content: string): Promise<Refusal[]> {
    const { repositoryRoot, addresses, secrets, check } = this.rules;
    const { screens } = this.session!;
    const syntax = await moduleSyntax(content);
    if (!syntax.ok) return [{ code: "TEST-SYNTAX", message: `The test does not parse as TypeScript: ${syntax.error}.` }];
    const coded = (code: string, messages: readonly string[]) => messages.map((message) => ({ code, message }));
    const written = [
      ...coded("TEST-IMPORT", importErrors(syntax.imports, join(repositoryRoot, path), repositoryRoot, this.rules.packages)),
      ...coded("TEST-FILE", fileErrors(content)),
      ...coded("TEST-ADDRESS", addressErrors(content, addresses)),
      ...coded("TEST-SECRET", secretValueErrors(content, secrets)),
    ];
    if (written.length > 0) return written;
    this.submitted = content;
    const { outline } = syntax;
    const sheet = skeleton(scenario, this.rules.screenshots);
    // A locator of the skeleton comes from the plan: the screens of its exploration showed it.
    const given = await locatorsOf(sheet);
    const own = outline.locators.filter((locator) => !given.some((planned) => planned.role === locator.role && planned.text === locator.text));
    const unseen = screens.unseen(scenario.application, own);
    const located = unseen.length === 0 ? [] : [this.unseenRefusal(scenario.application, unseen)];
    const help = { skeleton: sheet, codes: screens.codes(scenario.application) };
    const planned = [...scenarioErrors(outline, scenario, help), ...located];
    if (planned.length > 0) return planned;
    return check === undefined ? [] : coded("TEST-CHECK", (await check.check({ path, content })).map(findingText));
  }

  /** The refusal of locators no screen showed: them, and the closest elements the agent saw, which are what the gate would accept. */
  private unseenRefusal(application: string, unseen: readonly SpecLocator[]): Refusal {
    const nearest = this.session!.screens.nearest(application, unseen);
    const closest = nearest.length === 0 ? [] : ["Closest elements you saw:", ...nearest];
    const message = [
      `no screen you looked at showed ${unseen.map((locator) => locator.code).join(", ")}.`,
      ...closest,
      `Copy a locator as given, or take ${scopedToolName(application, "snapshot")} at that step.`,
    ].join("\n");
    return {
      code: "TEST-LOCATOR",
      message,
      ...(nearest.length === 0 ? {} : { remedy: ["Copy the locator of one of these elements, as given:", ...nearest].join("\n") }),
    };
  }

  /**
   * Refuses a call about the scenario open, and counts it: from the third refusal of one reason the agent
   * is told only what the gate would accept, and the fifth closes the scenario, with the test of its last
   * run that gave a verdict, or without a test when none did.
   */
  private refuse(what: string, refusals: readonly Refusal[]): string | { error: string } {
    const masked = maskedRefusals(refusals, (text) => this.mask(text));
    journalRefusals(this.journal, what, masked);
    this.refusedCodes.push(...new Set(masked.map((refusal) => refusal.code)));
    this.streak.record(masked);
    const { code, times } = this.streak.repeated(masked);
    if (times < GUIDED_REFUSALS) return { error: refusalText(masked) };
    if (times < MAX_REFUSALS) return { error: repeatedText(code, times, masked) };
    const open = { cursor: this.cursor, scenario: this.cursor.scenario!, path: this.cursor.path! };
    const closing = `closed by the harness after ${MAX_REFUSALS} refusals for ${code}`;
    const ended = open.cursor.runs.findLast(judged);
    if (ended === undefined) {
      this.unfinished(open, code, `The harness closed the scenario after ${MAX_REFUSALS} refusals for ${code}.`);
      return this.next(open.cursor, `Scenario ${open.scenario.id} was ${closing}; its test is kept as unfinished.`);
    }
    // A test that ran to a verdict is kept as it ended: the refusals came after it.
    const quarantine = ended.verdict === "passed" ? undefined : quarantineOf("test", closing, ended);
    const reason = `${ended.verdict === "passed" ? "Its last run passed; the scenario was" : "The scenario was"} ${closing}.`;
    const classing: Classed = { class: quarantine === undefined ? "passed" : "failing-test", origin: { by: "harness", check: code }, reason };
    const outcome = this.keep(open, ended, quarantine, classing, code);
    this.journal.record(
      "error",
      `The scenario ${open.scenario.id} was ${closing}; the test of its last run that gave a verdict is kept, ${outcome}: ${open.path}.`,
    );
    return this.next(open.cursor, `Scenario ${open.scenario.id} was ${closing}, with the test of its last run: ${outcome}.`);
  }

  /** What a trial gave, for the agent, every declared value masked before the error is cut. */
  private described(trial: TestTrial): string {
    return described(trial, (text) => this.mask(text));
  }

  /** A text with every declared value masked. */
  private mask(text: string): string {
    return redactText(text, this.forms);
  }
}

/** The scenario open, with the file of its test. */
interface Open {
  readonly cursor: DesignCursor;
  readonly scenario: PlannedScenario;
  readonly path: string;
}

/** How a test is classed, before the date. */
type Classed = Omit<TestClassing, "at">;

/** The runs of the scenario open, as a design state lists them. */
function runsOf(cursor: DesignCursor): DesignedRun[] {
  return cursor.runs.map(({ verdict, errorClass: stopped, failedStep }) => ({
    ...(verdict === undefined ? {} : { verdict }),
    ...(stopped === undefined ? {} : { errorClass: stopped }),
    ...(failedStep === undefined ? {} : { failedStep }),
  }));
}

/** A run in a few words, for what was tried on a test left unfinished. */
function runText(run: DesignedRun): string {
  if (run.verdict === undefined) return "no verdict";
  if (run.verdict === "passed") return "passed";
  return `${run.verdict} on ${run.errorClass}${run.failedStep === undefined ? "" : ` at ${JSON.stringify(run.failedStep)}`}`;
}

/** Whether a run gave a verdict: it passed or failed. */
function judged(run: ScenarioRun): boolean {
  return run.verdict === "passed" || run.verdict === "failed";
}

/** Why a test is kept failing: the cause and the evidence, with where and on what its run failed. */
function quarantineOf(cause: FailureCause, evidence: string, run: ScenarioRun): Quarantine {
  return { cause, evidence, ...(run.failedStep === undefined ? {} : { failedStep: run.failedStep }), errorClass: run.errorClass! };
}

/** A text with its first letter in upper case. */
function capitalised(text: string): string {
  return `${text[0]!.toUpperCase()}${text.slice(1)}`;
}

/** A finding of the check, in one sentence the agent can act on: where, what, the rule or the code, and the example of the rule. */
function findingText(finding: TestFinding): string {
  const label = finding.kind === "charter" ? `rule ${finding.rule}` : `compiler ${finding.code}`;
  const example = finding.kind === "charter" && finding.example !== undefined ? ` Example: ${finding.example}` : "";
  return `Line ${finding.line}, column ${finding.column} (${label}): ${finding.message}${example}`;
}

/** The verdict of a file: `passed` when each of its tests passed, the first other verdict otherwise, and `not_run` without any test. */
function verdictOf(trial: TestTrial): Verdict {
  return trial.tests.find((test) => test.verdict !== "passed")?.verdict ?? (trial.tests.length === 0 ? "not_run" : "passed");
}

/**
 * What a trial gave, for the agent: each test with its verdict and, for one that did not pass, its error,
 * cut past `MAX_TOLD_ERROR` characters, its step and its trace.
 */
function described(trial: TestTrial, mask: (text: string) => string): string {
  const tests = trial.tests.map((test) => {
    const lines = [`- ${mask(test.id)}: ${test.verdict}.`];
    if (test.verdict !== "passed") {
      const error = mask(test.reason);
      lines.push(`  Error: ${error.length > MAX_TOLD_ERROR ? `${error.slice(0, MAX_TOLD_ERROR)}…` : error}`);
      if (test.failedStep !== undefined) lines.push(`  Failed step: ${mask(test.failedStep)}`);
      if (test.trace !== undefined) lines.push(`  Trace: ${test.trace}`);
    }
    return lines.join("\n");
  });
  const logs = trial.tests.some((test) => test.verdict !== "passed") ? [`The logs of the services since ${trial.startedAt} tell what they did meanwhile.`] : [];
  return [`Run of the file: ${verdictOf(trial)}.`, ...tests, ...logs].join("\n");
}
