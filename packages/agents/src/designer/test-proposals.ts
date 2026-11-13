import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import type { PlannedScenario, TestPlan, ToolDefinition } from "@open-qa-stack/domain";
import { moduleSyntax, redactText, secretForms } from "@open-qa-stack/tools";
import type { Journal } from "../common/journal.ts";
import { DesignCursor } from "./design-cursor.ts";
import type { DesignedTest, FailureCause, Quarantine } from "./design-state.ts";
import { PLAN_TOOL } from "./plan-proposal.ts";
import { journalRefusals, refusalText, type Refusal } from "./refusal.ts";
import { scenarioSheet } from "./scenario-sheet.ts";
import type { ScreenWatch } from "./screen-watch.ts";
import type { TestCheck, TestFinding, TestReference, TestRunner, TestTrial, Verdict } from "@open-qa-stack/domain";
import { addressErrors, fileErrors, heldVariables, importErrors, secretValueErrors, type DeclaredSecret } from "./spec-rules.ts";

/** Name of the tool the designer closes a scenario with. */
export const PROPOSE_TOOL = "propose_test";
/** Name of the tool the designer runs the test of a scenario with. */
export const RUN_TOOL = "run_test";
/** Longest error told to the agent for a test that did not pass. */
const MAX_TOLD_ERROR = 4000;
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
  /** What the agent saw of the screens, which a test must rely on. */
  readonly screens: ScreenWatch;
  /** Whether each step of a test ends with a screenshot attached to the report, as the charter may ask. */
  readonly screenshots: boolean;
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
 * Once the plan is accepted, a cursor opens its first scenario and names the file of its test. `run_test`
 * takes the whole text of that file, checks it, and runs it against the application: a text is refused,
 * with every reason of the first tier that refuses it and its code, when it does not parse as TypeScript,
 * imports anything but the packages of the test repository or a relative path inside it, imports another
 * test, writes a file, holds an address of the configuration or the value of a declared variable; then when
 * it uses a locator no screen showed; then when the check given finds something. `propose_test` closes the
 * scenario open with the text of its last run, which must have run to a verdict: passed, it is kept as
 * passed; failed, it is kept unchanged, as failing, with the cause and the evidence the agent gives. The
 * verdict is the harness's, never the agent's. Every refusal is journaled with its code and told to the
 * agent, every declared value masked.
 */
export class TestProposals {
  private readonly rules: ProposalRules;
  private readonly journal: Journal;
  private readonly kept: AcceptedTest[] = [];
  private readonly forms: readonly string[];
  private cursor: DesignCursor | undefined;
  /** The references a run made, by the text that ran. */
  private readonly references = new Map<string, readonly TestReference[]>();

  /**
   * @param rules - What the tests are checked against.
   * @param journal - Where refusals, runs and the scenarios closed are written.
   */
  public constructor(rules: ProposalRules, journal: Journal) {
    this.rules = rules;
    this.journal = journal;
    this.forms = rules.secrets.flatMap((secret) => secretForms(secret.value));
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
   * Starts carrying out an accepted plan: opens its first scenario.
   *
   * @param plan - The plan.
   * @returns The sheet of the first scenario.
   */
  public start(plan: TestPlan): string {
    this.cursor = new DesignCursor(plan, (scenario) => this.place(scenario));
    return this.opened(this.cursor);
  }

  /**
   * The tool the agent runs the test of the scenario open with.
   *
   * @returns The tool.
   */
  public trialTool(): ToolDefinition {
    return {
      name: RUN_TOOL,
      description: "Checks the test of the open scenario, then runs it against the application with the real runner. Give the whole file: one test, one test.step per step of the plan, as in the skeleton. Returns the verdict, the error, the step that failed and what to look at.",
      parameters: {
        type: "object",
        properties: { content: { type: "string", minLength: 1, description: "The whole text of the file, in TypeScript." } },
        required: ["content"],
        additionalProperties: false,
      },
      execute: async (args) => this.tryTest((args as { content: string }).content),
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
      description: "Closes the open scenario with the test of its last run. A test that passed is kept. A test that failed is kept as failing, with your diagnosis, for a person to decide; it is never changed to pass.",
      parameters: {
        type: "object",
        properties: {
          diagnosis: {
            type: "object",
            properties: {
              cause: {
                type: "string",
                enum: ["application", "plan", "test"],
                description: "application: the run failed on an assertion, and the application does not do what the plan expects. plan: the run failed on an assertion, and an expected text of the plan is wrong. test: the test could not be made to work.",
              },
              evidence: { type: "string", minLength: 1, description: "What the run showed and what you checked: expected, received, the screen, the logs." },
            },
            required: ["cause", "evidence"],
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      execute: async (args) => this.propose((args as { diagnosis?: Diagnosis }).diagnosis),
    };
  }

  /**
   * The message that reminds an agent which stopped before every scenario was closed.
   *
   * @returns The reminder; `undefined` before a plan is accepted, and once every scenario is closed.
   */
  public reminder(): string | undefined {
    const cursor = this.cursor;
    const scenario = cursor?.scenario;
    if (scenario === undefined) return undefined;
    const last = cursor!.runs.at(-1);
    const where = `Scenario ${cursor!.rank} of ${cursor!.plan.scenarios.length}, ${scenario.id}`;
    const state = last === undefined ? "its test has not run" : last.verdict === "passed" ? "its test passed and is not closed" : "its last run failed";
    this.journal.record("info", `The agent stopped before scenario ${scenario.id} was closed; it was reminded to go on.`);
    return `You stopped before the end. ${where}: ${state}.\n${cursor!.next()}`;
  }

  /** Checks the test of the scenario open, runs it, and tells the agent what the run gave. */
  private async tryTest(content: string): Promise<string | { error: string }> {
    const open = this.open();
    if ("error" in open) return open;
    const { cursor, scenario, path } = open;
    const refusals = await this.checked(scenario, path, content);
    if (refusals.length > 0) return this.refuse(`The test ${path} could not be run`, refusals);
    const trial = await this.rules.runner.run({ path, content });
    if (trial.error !== undefined) {
      cursor.record(scenario.id, { content });
      this.journal.record("error", this.mask(`The test ${path} could not run: ${trial.error}`));
      return this.mask(`Run of the file: it could not run: ${trial.error}\n${cursor.next()}`);
    }
    const verdict = verdictOf(trial);
    cursor.record(scenario.id, { content, verdict });
    this.references.set(content, trial.references ?? []);
    this.journal.record("info", `The test ${path} was run: ${verdict}.`);
    return `${this.described(trial)}\n${cursor.next()}`;
  }

  /** Closes the scenario open with the text of its last run. */
  private propose(diagnosis: Diagnosis | undefined): string | { error: string } {
    const open = this.open();
    if ("error" in open) return open;
    const { cursor, scenario, path } = open;
    const last = cursor.runs.at(-1);
    const what = `The scenario ${scenario.id} could not be closed`;
    if (last?.verdict !== "passed" && last?.verdict !== "failed") return this.refuse(what, [{ code: "PROPOSE-RUN", message: `scenario ${scenario.id} has not run${last === undefined ? "" : " to a verdict"}. Call ${RUN_TOOL} first.` }]);
    let quarantine: Quarantine | undefined;
    if (last.verdict === "failed") {
      if (diagnosis === undefined) return this.refuse(what, [{ code: "PROPOSE-DIAG", message: `the last run of scenario ${scenario.id} failed. Repair it with ${RUN_TOOL}, or give diagnosis: the cause and what the run showed.` }]);
      const held = heldVariables(diagnosis.evidence, this.rules.secrets).map((variable) => ({ code: "PROPOSE-SECRET", message: `the diagnosis holds the value of ${variable}. Leave it out; a test reads it with process.env.${variable}.` }));
      if (held.length > 0) return this.refuse(what, held);
      quarantine = { cause: diagnosis.cause, evidence: diagnosis.evidence };
    }
    this.kept.push({ path, scenario: scenario.id, verdict: last.verdict, ...(quarantine === undefined ? {} : { quarantine }), content: last.content, references: this.references.get(last.content)! });
    const outcome = quarantine === undefined ? "passed" : `failing (${quarantine.cause}), kept for a person to decide`;
    this.journal.record("info", `The scenario ${scenario.id} was closed: ${outcome}; its test is ${path}.`);
    cursor.close();
    const closed = `Scenario ${scenario.id} closed: ${outcome}.`;
    if (cursor.scenario !== undefined) return `${closed}\n\n${this.opened(cursor)}`;
    const failing = this.kept.filter((test) => test.verdict !== "passed").length;
    return `${closed}\nAll ${cursor.plan.scenarios.length} scenarios are closed: ${this.kept.length - failing} passed, ${failing} failing.\n${cursor.next()}`;
  }

  /** The scenario open and the file of its test, or why there is none. */
  private open(): { readonly cursor: DesignCursor; readonly scenario: PlannedScenario; readonly path: string } | { error: string } {
    const cursor = this.cursor;
    if (cursor === undefined) return { error: refusalText([{ code: "PLAN-NONE", message: `no plan is accepted yet. Call ${PLAN_TOOL} first.` }]) };
    const scenario = cursor.scenario;
    if (scenario === undefined) return { error: refusalText([{ code: "PLAN-DONE", message: "every scenario of the plan is closed. Answer with one sentence; call no more tools." }]) };
    return { cursor, scenario, path: cursor.path! };
  }

  /** Journals the scenario the cursor opened, and gives its sheet. */
  private opened(cursor: DesignCursor): string {
    this.journal.record("info", `The scenario ${cursor.scenario!.id} was opened; its test is ${cursor.path}.`);
    return scenarioSheet(cursor, this.rules.screenshots);
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
    const { repositoryRoot, addresses, secrets, check, screens } = this.rules;
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
    const unseen = screens.unseen(scenario.application, syntax.outline.locators);
    if (unseen.length > 0) return [{ code: "TEST-LOCATOR", message: `no screen you looked at showed ${unseen.join(", ")}. Copy a locator as given, or take a snapshot at that step.` }];
    return check === undefined ? [] : coded("TEST-CHECK", (await check.check({ path, content })).map(findingText));
  }

  private refuse(what: string, refusals: readonly Refusal[]): { error: string } {
    const masked = refusals.map(({ code, message }) => ({ code, message: this.mask(message) }));
    journalRefusals(this.journal, what, masked);
    return { error: refusalText(masked) };
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
