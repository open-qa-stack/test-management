import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import type { ToolDefinition } from "@open-qa-stack/domain";
import { moduleSyntax, redactText, secretForms } from "@open-qa-stack/tools";
import type { Journal } from "../common/journal.ts";
import type { DesignedTest } from "./design-state.ts";
import type { TestCheck, TestFinding, TestRunner, TestTrial, Verdict } from "@open-qa-stack/domain";
import { addressErrors, importErrors, secretValueErrors, type DeclaredSecret } from "./spec-rules.ts";

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
export interface AcceptedTest extends DesignedTest {
  /** Text of the file. */
  readonly content: string;
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
}

/** The arguments of a proposal, once they match the schema of the tool. */
interface Proposal {
  readonly application: string;
  readonly domain: string;
  readonly file: string;
  readonly reason: string;
  readonly content: string;
  /** Why the application, not the test, is at fault, for a test that does not pass. */
  readonly failure?: string;
}

/** The arguments of a trial. */
type Trial = Pick<Proposal, "application" | "file" | "content">;

/**
 * The tests a designer proposes, one call of `propose_test` each, checked by the harness before they are
 * kept.
 *
 * @remarks
 * A test is refused when its path is already taken, its text does not parse as TypeScript, it imports
 * anything but `@playwright/test` or a relative path inside the test repository, imports another test,
 * holds an address of the configuration, or the proposal holds the value of a declared variable; then
 * when the check given finds something. A test that passes these rules is then run against the
 * application, unless that very text was already tried with `run_test`: it is kept when every one of its
 * tests passed, or when it did not pass and the agent explains why the application is at fault; it is
 * refused otherwise, with what the run gave. Its verdict is the harness's, never the agent's. Each refusal
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
          file: { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*\\.spec\\.ts$", description: "Name of the file, such as view-policy.spec.ts; it is placed in the folder of its application." },
          reason: { type: "string", minLength: 1, description: "Why the test is worth running, in one sentence." },
          content: { type: "string", minLength: 1, description: "The whole text of the file, in TypeScript." },
          failure: { type: "string", minLength: 1, description: "Only for a test that does not pass: why the application, not the test, is at fault, with what the run showed." },
        },
        required: ["application", "domain", "file", "reason", "content"],
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
          file: { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*\\.spec\\.ts$", description: "Name of the file, such as view-policy.spec.ts." },
          content: { type: "string", minLength: 1, description: "The whole text of the file, in TypeScript." },
        },
        required: ["application", "file", "content"],
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
    if (this.kept.length >= MIN_TESTS) return undefined;
    this.journal.record("info", `The agent stopped with fewer than ${MIN_TESTS} accepted tests (${this.kept.length}); it was reminded to propose more.`);
    return `Accepted tests so far: ${this.kept.length}. Propose at least ${MIN_TESTS} tests, and at most ${MAX_TESTS}, with ${PROPOSE_TOOL} now.`;
  }

  private async propose(proposal: Proposal): Promise<string | { error: string }> {
    const path = posix.join(this.rules.appsDir, proposal.application, proposal.file);
    if (this.kept.length >= MAX_TESTS) return this.setAside(path);
    const errors = await this.errors(path, proposal.content, `${proposal.reason}\n${proposal.failure ?? ""}`);
    if (errors.length > 0) return this.refuse(path, errors);
    const trial = this.trials.get(trialKey(path, proposal.content)) ?? (await this.trial(path, proposal.content));
    if (trial.error !== undefined) return this.refuse(path, [`The test could not run: ${trial.error}`]);
    const verdict = verdictOf(trial);
    if (verdict !== "passed" && proposal.failure === undefined) {
      return this.refuse(path, [`It does not pass. Fix it, or, if the application is at fault, propose it again with failure saying why.\n${described(trial)}`]);
    }
    // Proposals made in one turn are checked at once: others may have been accepted during the check.
    if (this.kept.length >= MAX_TESTS) return this.setAside(path);
    const failure = verdict === "passed" ? {} : { failure: proposal.failure! };
    this.kept.push({ path, application: proposal.application, domain: proposal.domain, reason: proposal.reason, verdict, ...failure, content: proposal.content });
    this.journal.record("info", `The test ${path} was accepted.`);
    const count = this.kept.length;
    const next = count < MIN_TESTS ? `Propose at least ${MIN_TESTS - count} more.` : count < MAX_TESTS ? "You may propose one more, or answer with one sentence." : "Answer with one sentence; call no more tools.";
    return `The test ${path} was accepted (${count} of at most ${MAX_TESTS}). ${next}`;
  }

  /** Tries a test the rules accept, and tells the agent what the run gave. */
  private async tryTest(args: Trial): Promise<string | { error: string }> {
    const path = posix.join(this.rules.appsDir, args.application, args.file);
    const errors = await this.errors(path, args.content, "");
    if (errors.length > 0) return this.refuse(path, errors, "could not be run");
    const trial = await this.trial(path, args.content);
    if (trial.error !== undefined) return this.refuse(path, [trial.error], "could not be run");
    return this.mask(described(trial));
  }

  /** Runs a test, journals its verdict, and keeps the trial of that text. */
  private async trial(path: string, content: string): Promise<TestTrial> {
    const trial = await this.rules.runner.run({ path, content });
    this.trials.set(trialKey(path, content), trial);
    this.journal.record(trial.error === undefined ? "info" : "error", this.mask(trial.error === undefined ? `The test ${path} was run: ${verdictOf(trial)}.` : `The test ${path} could not run: ${trial.error}`));
    return trial;
  }

  /** What the rules refuse in a test, its text and what goes with it; nothing when it may run. */
  private async errors(path: string, content: string, comments: string): Promise<string[]> {
    const { repositoryRoot, addresses, secrets, check } = this.rules;
    if (this.kept.some((test) => test.path === path) || existsSync(join(repositoryRoot, path))) return [`${path} is already taken; give the test another file name.`];
    const syntax = await moduleSyntax(content);
    if (!syntax.ok) return [`The test does not parse as TypeScript: ${syntax.error}.`];
    const errors = [...importErrors(syntax.imports, join(repositoryRoot, path), repositoryRoot), ...addressErrors(content, addresses), ...secretValueErrors(`${comments}\n${content}`, secrets)];
    if (errors.length > 0 || check === undefined) return errors;
    return (await check.check({ path, content })).map(findingText);
  }

  private setAside(path: string): string {
    this.journal.record("info", `The test ${path} was set aside: ${MAX_TESTS} tests were already accepted.`);
    return `${MAX_TESTS} tests were already accepted; this one was set aside. Answer with one sentence; call no more tools.`;
  }

  private refuse(path: string, errors: readonly string[], what = "was refused"): { error: string } {
    for (const error of errors) this.journal.record("error", this.mask(`The test ${path} ${what}: ${error}`));
    return { error: this.mask([`The test ${path} ${what}. Fix it, then try it again.`, ...errors.map((error) => `- ${error}`)].join("\n")) };
  }

  /** A text with every declared value masked. */
  private mask(text: string): string {
    return redactText(text, this.forms);
  }

}

/** A finding of the check, in one sentence the agent can act on: where, what, and the rule or the code. */
function findingText(finding: TestFinding): string {
  const label = finding.kind === "charter" ? `rule ${finding.rule}` : `compiler ${finding.code}`;
  return `Line ${finding.line}, column ${finding.column} (${label}): ${finding.message}`;
}

/** The key of the trial of a text at a path. */
function trialKey(path: string, content: string): string {
  return `${path}\n${content}`;
}

/** The verdict of a file: `passed` when each of its tests passed, the first other verdict otherwise. */
function verdictOf(trial: TestTrial): Verdict {
  return trial.tests.find((test) => test.verdict !== "passed")?.verdict ?? (trial.tests.length === 0 ? "not_run" : "passed");
}

/** What a trial gave, for the agent: each test with its verdict and, for one that did not pass, its error, step and trace. */
function described(trial: TestTrial): string {
  const tests = trial.tests.map((test) => {
    const lines = [`- ${test.id}: ${test.verdict}.`];
    if (test.verdict !== "passed") {
      lines.push(`  Error: ${test.reason.length > MAX_TOLD_ERROR ? `${test.reason.slice(0, MAX_TOLD_ERROR)}…` : test.reason}`);
      if (test.failedStep !== undefined) lines.push(`  Failed step: ${test.failedStep}`);
      if (test.trace !== undefined) lines.push(`  Trace: ${test.trace}`);
    }
    return lines.join("\n");
  });
  const logs = trial.tests.some((test) => test.verdict !== "passed") ? [`The logs of the services since ${trial.startedAt} tell what they did meanwhile.`] : [];
  return [`Run of the file: ${verdictOf(trial)}.`, ...tests, ...logs].join("\n");
}
