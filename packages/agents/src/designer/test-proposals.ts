import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import type { ToolDefinition } from "@open-qa-stack/domain";
import { moduleSyntax, redactText, secretForms } from "@open-qa-stack/tools";
import type { Journal } from "../common/journal.ts";
import type { DesignedTest } from "./design-state.ts";
import type { PlanProposal } from "./plan-proposal.ts";
import type { ScreenWatch } from "./screen-watch.ts";
import type { TestCheck, TestFinding, TestReference, TestRunner, TestTrial, Verdict } from "@open-qa-stack/domain";
import { addressErrors, fileErrors, importErrors, secretValueErrors, type DeclaredSecret } from "./spec-rules.ts";

/** Name of the tool the designer proposes a test with. */
export const PROPOSE_TOOL = "propose_test";
/** Name of the tool the designer tries a test with. */
export const RUN_TOOL = "run_test";
/** Longest error told to the agent for a test that did not pass. */
const MAX_TOLD_ERROR = 4000;
/** Fewest tests a design must give. */
export const MIN_TESTS = 3;
/** Most tests a design writes; those proposed after are set aside. */
export const MAX_TESTS = 4;

/** A test accepted, with its text. */
export interface AcceptedTest extends Omit<DesignedTest, "references"> {
  /** Text of the file. */
  readonly content: string;
  /** The references of its visual comparisons, made at its run, to write with it. */
  readonly references: readonly TestReference[];
}

/** What the proposals are checked against. */
export interface ProposalRules {
  /** Absolute path of the test repository. */
  readonly repositoryRoot: string;
  /** Folder of the applications, relative to the root of the test repository. */
  readonly appsDir: string;
  /** Identifiers of the applications a test may be about. */
  readonly applications: readonly string[];
  /** Identifiers of the domains of the index. */
  readonly domains: readonly string[];
  /** The addresses no test may hold, as `declaredAddresses` gives them. */
  readonly addresses: readonly string[];
  /** The values no proposal may hold, masked in every refusal. */
  readonly secrets: readonly DeclaredSecret[];
  /** The check run on a test the harness found nothing to refuse in, if any. */
  readonly check?: TestCheck;
  /** Runs a test file against the application: every test is run before it is kept. */
  readonly runner: TestRunner;
  /** The packages a test may import, as `testPackages` gives them. */
  readonly packages: readonly string[];
  /** The test plan, which must be accepted before any test is run or proposed. */
  readonly plan: PlanProposal;
  /** What the agent saw of the screens, which a test must rely on. */
  readonly screens: ScreenWatch;
}

/** The arguments of a proposal, once they match the schema of the tool. */
interface Proposal {
  readonly application: string;
  readonly domain: string;
  readonly scenario: string;
  /** The assertion of the test that verifies the expected result of its scenario, as written in it. */
  readonly verifies: string;
  readonly file: string;
  readonly reason: string;
  readonly content: string;
  /** Why the application, not the test, is at fault, for a test that does not pass. */
  readonly failure?: string;
}

/** The arguments of a trial. */
type Trial = Pick<Proposal, "application" | "scenario" | "file" | "content">;

/**
 * The tests a designer proposes, one call of `propose_test` each, checked by the harness before they are
 * kept.
 *
 * @remarks
 * No test is run or proposed before the test plan is accepted, and each test names a scenario of it and
 * copies the `expect` assertion that verifies the expected result of that scenario; in a functional
 * scenario, that assertion follows an action, repeats no earlier check, and names something the action
 * produced. A test of an application with a user interface is run only once the agent looked at its
 * screens — and did the steps itself, for a functional scenario — and uses only locators the screens
 * showed. A test is refused when its path is already taken, its text does not parse as TypeScript, it imports
 * anything but `@playwright/test` or a relative path inside the test repository, imports another test,
 * holds an address of the configuration, or the proposal holds the value of a declared variable; then
 * when the check given finds something. A test that passes these rules is then run against the
 * application, unless that very text was already tried with `run_test`: it is kept when every one of its
 * tests passed, or when it failed in a run the agent saw and the agent explains why the application is at
 * fault; it is refused otherwise, with what the run gave, and always when it did not run to a verdict. Its verdict is the harness's, never the agent's. Each refusal
 * is journaled and told to the agent, every declared value masked, so that it may try and propose again.
 * The first `MAX_TESTS` accepted are kept; any later one is set aside and journaled.
 */
export class TestProposals {
  private readonly rules: ProposalRules;
  private readonly journal: Journal;
  private readonly kept: AcceptedTest[] = [];
  private readonly forms: readonly string[];
  /** The trial of each text tried, by path and text. */
  private readonly trials = new Map<string, TestTrial>();

  /**
   * @param rules - What the proposals are checked against.
   * @param journal - Where refusals, acceptances and the tests set aside are written.
   */
  public constructor(rules: ProposalRules, journal: Journal) {
    this.rules = rules;
    this.journal = journal;
    this.forms = rules.secrets.flatMap((secret) => secretForms(secret.value));
  }

  /**
   * The tests accepted so far.
   *
   * @returns A copy, in the order they were accepted.
   */
  public get accepted(): AcceptedTest[] {
    return [...this.kept];
  }

  /**
   * The tool the agent proposes a test with.
   *
   * @returns The tool.
   */
  public tool(): ToolDefinition {
    return {
      name: PROPOSE_TOOL,
      description: `Proposes one Playwright test file. Propose between ${MIN_TESTS} and ${MAX_TESTS} tests, one call each; a refused test can be fixed and proposed again.`,
      parameters: {
        type: "object",
        properties: {
          application: { type: "string", enum: [...this.rules.applications], description: "Identifier of the one application the test is about." },
          domain: { type: "string", enum: [...this.rules.domains], description: "Identifier of the domain of the index the test comes from." },
          scenario: { type: "string", minLength: 1, description: "Identifier of the scenario of the accepted plan the test carries out." },
          verifies: { type: "string", minLength: 1, description: "The assertion of the test that verifies the expected result of its scenario, copied as written in the test, such as: await expect(page.getByRole('row', { name: 'ORD-1042' })).toContainText('Mira Veldane');" },
          file: { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*\\.spec\\.ts$", description: "Name of the file, such as view-policy.spec.ts; it is placed in the folder of its application." },
          reason: { type: "string", minLength: 1, description: "Why the test is worth running, in one sentence." },
          content: { type: "string", minLength: 1, description: "The whole text of the file, in TypeScript." },
          failure: { type: "string", minLength: 1, description: "Only for a test that does not pass: why the application, not the test, is at fault, with what the run showed." },
        },
        required: ["application", "domain", "scenario", "verifies", "file", "reason", "content"],
        additionalProperties: false,
      },
      execute: async (args) => this.propose(args as Proposal),
    };
  }

  /**
   * The tool the agent tries a test with, against the application, before it proposes it.
   *
   * @returns The tool.
   */
  public trialTool(): ToolDefinition {
    return {
      name: RUN_TOOL,
      description: `Runs one Playwright test file against the application, with the real runner, and gives the verdict of each of its tests, the error, the step that failed and the trace. Run each test, fix it until it passes, then propose it with ${PROPOSE_TOOL}.`,
      parameters: {
        type: "object",
        properties: {
          application: { type: "string", enum: [...this.rules.applications], description: "Identifier of the one application the test is about." },
          scenario: { type: "string", minLength: 1, description: "Identifier of the scenario of the accepted plan the test carries out." },
          file: { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*\\.spec\\.ts$", description: "Name of the file, such as view-policy.spec.ts." },
          content: { type: "string", minLength: 1, description: "The whole text of the file, in TypeScript." },
        },
        required: ["application", "scenario", "file", "content"],
        additionalProperties: false,
      },
      execute: async (args) => this.tryTest(args as Trial),
    };
  }

  /**
   * The message that reminds an agent which stopped too early to propose more tests.
   *
   * @returns The reminder; `undefined` once `MIN_TESTS` tests were accepted.
   */
  public reminder(): string | undefined {
    if (this.kept.length >= MIN_TESTS || this.rules.plan.refused !== undefined) return undefined;
    if (this.rules.plan.accepted === undefined) {
      this.journal.record("info", "The agent stopped without an accepted plan; it was reminded to submit one.");
      return this.rules.plan.blocked();
    }
    this.journal.record("info", `The agent stopped with fewer than ${MIN_TESTS} accepted tests (${this.kept.length}); it was reminded to propose more.`);
    return `Accepted tests so far: ${this.kept.length}. Propose at least ${MIN_TESTS} tests, and at most ${MAX_TESTS}, with ${PROPOSE_TOOL} now.`;
  }

  private async propose(proposal: Proposal): Promise<string | { error: string }> {
    const path = posix.join(this.rules.appsDir, proposal.application, proposal.file);
    const blocked = this.rules.plan.blocked();
    if (blocked !== undefined) return this.refuse(path, [blocked]);
    if (this.kept.length >= MAX_TESTS) return this.setAside(path);
    const errors = await this.errors(path, proposal, `${proposal.reason}\n${proposal.failure ?? ""}`);
    if (errors.length > 0) return this.refuse(path, errors);
    if (!quotesAssertion(proposal.content, proposal.verifies)) return this.refuse(path, ["verifies must copy, as written in the test, the expect assertion that verifies the expected result of its scenario."]);
    if (this.functional(proposal.scenario)) {
      if (!followsAction(proposal.content, proposal.verifies)) {
        return this.refuse(path, ["In a functional scenario, the assertion of verifies checks what an action produced: it comes after a goto, a click, a fill or a request, and repeats no check made before. Do the steps with the browser tools, see what the screen shows after the action, and assert that."]);
      }
      if (this.rules.screens.shownBefore(proposal.application, proposal.verifies)) {
        return this.refuse(path, ["What verifies names was already on the page before the action: it verifies nothing of the scenario. Assert what appeared after the action, as the browser tools told you: a row, a text, a value."]);
      }
    }
    const seen = this.trials.get(trialKey(path, proposal.content));
    const trial = seen ?? (await this.trial(path, proposal.content));
    if (trial.error !== undefined) return this.refuse(path, [`The test could not run: ${trial.error}`]);
    const verdict = verdictOf(trial);
    if (verdict !== "passed" && verdict !== "failed") return this.refuse(path, [`It did not run to a verdict (${verdict}); a test that has not run cannot be kept. Fix it and run it again.\n${this.described(trial)}`]);
    // The agent may hold the application at fault only for a run it saw.
    if (verdict === "failed" && (proposal.failure === undefined || seen === undefined)) {
      return this.refuse(path, [`It does not pass. Fix it, or, if the application is at fault, run it with ${RUN_TOOL}, then propose it again with failure saying why.\n${this.described(trial)}`]);
    }
    // Proposals made in one turn are checked at once: others may have been accepted, or taken this path, meanwhile.
    if (this.kept.length >= MAX_TESTS) return this.setAside(path);
    if (this.kept.some((test) => test.path === path)) return this.refuse(path, [`${path} is already taken; give the test another file name.`]);
    const failure = verdict === "passed" ? {} : { failure: proposal.failure! };
    this.kept.push({ path, application: proposal.application, domain: proposal.domain, scenario: proposal.scenario, verifies: proposal.verifies.trim(), reason: proposal.reason, verdict, ...failure, content: proposal.content, references: trial.references ?? [] });
    this.journal.record("info", `The test ${path} was accepted.`);
    const count = this.kept.length;
    const next = count < MIN_TESTS ? `Propose at least ${MIN_TESTS - count} more.` : count < MAX_TESTS ? "You may propose one more, or answer with one sentence." : "Answer with one sentence; call no more tools.";
    return `The test ${path} was accepted (${count} of at most ${MAX_TESTS}). ${next}`;
  }

  /** Tries a test the rules accept, and tells the agent what the run gave. */
  private async tryTest(args: Trial): Promise<string | { error: string }> {
    const path = posix.join(this.rules.appsDir, args.application, args.file);
    const blocked = this.rules.plan.blocked();
    if (blocked !== undefined) return this.refuse(path, [blocked], "could not be run");
    const errors = await this.errors(path, args, "");
    if (errors.length > 0) return this.refuse(path, errors, "could not be run");
    const trial = await this.trial(path, args.content);
    if (trial.error !== undefined) return this.refuse(path, [trial.error], "could not be run");
    return this.described(trial);
  }

  /** Runs a test, journals its verdict, and keeps the trial of that text. */
  private async trial(path: string, content: string): Promise<TestTrial> {
    const trial = await this.rules.runner.run({ path, content });
    this.trials.set(trialKey(path, content), trial);
    this.journal.record(trial.error === undefined ? "info" : "error", this.mask(trial.error === undefined ? `The test ${path} was run: ${verdictOf(trial)}.` : `The test ${path} could not run: ${trial.error}`));
    return trial;
  }

  /** Whether a scenario of the accepted plan is functional. */
  private functional(scenario: string): boolean {
    return this.rules.plan.accepted!.scenarios.find((planned) => planned.id === scenario)!.kind === "functional";
  }

  /** What the rules refuse in a test, its text and what goes with it; nothing when it may run. */
  private async errors(path: string, test: Trial, comments: string): Promise<string[]> {
    const { repositoryRoot, addresses, secrets, check, screens } = this.rules;
    const { content } = test;
    const scenarios = this.rules.plan.accepted!.scenarios.map((scenario) => scenario.id);
    if (!scenarios.includes(test.scenario)) return [`${test.scenario} is no scenario of the accepted plan; the scenarios are ${scenarios.join(", ")}.`];
    const missing = screens.missing(test.application, this.functional(test.scenario));
    if (missing !== undefined) return [missing];
    if (this.kept.some((test) => test.path === path) || existsSync(join(repositoryRoot, path))) return [`${path} is already taken; give the test another file name.`];
    const syntax = await moduleSyntax(content);
    if (!syntax.ok) return [`The test does not parse as TypeScript: ${syntax.error}.`];
    const errors = [...importErrors(syntax.imports, join(repositoryRoot, path), repositoryRoot, this.rules.packages), ...fileErrors(content), ...addressErrors(content, addresses), ...secretValueErrors(`${comments}\n${content}`, secrets)];
    if (errors.length > 0) return errors;
    const unseen = screens.unseen(test.application, content);
    if (unseen.length > 0) return [`No screen you looked at showed ${unseen.join(", ")}. Use only locators the snapshots gave, copied as given; take a snapshot of the page at that step to find the right one.`];
    return check === undefined ? [] : (await check.check({ path, content })).map(findingText);
  }

  private setAside(path: string): string {
    this.journal.record("info", `The test ${path} was set aside: ${MAX_TESTS} tests were already accepted.`);
    return `${MAX_TESTS} tests were already accepted; this one was set aside. Answer with one sentence; call no more tools.`;
  }

  private refuse(path: string, errors: readonly string[], what = "was refused"): { error: string } {
    for (const error of errors) this.journal.record("error", this.mask(`The test ${path} ${what}: ${error}`));
    return { error: this.mask([`The test ${path} ${what}. Fix it, then try it again.`, ...errors.map((error) => `- ${error}`)].join("\n")) };
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

/** A text without its spaces, its quotes all written alike, and without a last semicolon: what two writings of one assertion share. */
function compact(text: string): string {
  return text.replace(/\s+/g, "").replace(/['`]/g, '"').replace(/;$/, "");
}

/** Whether a text is an `expect` assertion of a test, whatever its spaces and the quotes it is written with. */
function quotesAssertion(content: string, verifies: string): boolean {
  return verifies.includes("expect") && compact(content).includes(compact(verifies));
}

/** An action of a test: a navigation, an input, or a request to an API. */
const ACTION = /\.(goto|click|dblclick|fill|press|type|check|uncheck|selectOption|setInputFiles|get|post|put|patch|delete|fetch)\(/g;

/**
 * Whether an assertion, spaces aside, checks what an action produced: an action comes before it, and no
 * other line of the test makes the same check.
 */
function followsAction(content: string, verifies: string): boolean {
  const text = compact(content);
  const assertion = compact(verifies);
  const at = text.indexOf(assertion);
  return text.indexOf(assertion, at + 1) === -1 && [...text.slice(0, at).matchAll(ACTION)].length > 0;
}

/** The key of the trial of a text at a path. */
function trialKey(path: string, content: string): string {
  return `${path}\n${content}`;
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
