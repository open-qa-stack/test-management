import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import type { ToolDefinition } from "@open-qa-stack/domain";
import { moduleSyntax, redactText, secretForms } from "@open-qa-stack/tools";
import type { Journal } from "../common/journal.ts";
import type { DesignedTest } from "./design-state.ts";
import type { SpecCheck } from "./spec-check.ts";
import { addressErrors, importErrors, secretValueErrors, type DeclaredSecret } from "./spec-rules.ts";

/** Name of the tool the designer proposes a test with. */
export const PROPOSE_TOOL = "propose_test";
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
  readonly check?: SpecCheck;
}

/** The arguments of a proposal, once they match the schema of the tool. */
interface Proposal {
  readonly application: string;
  readonly domain: string;
  readonly file: string;
  readonly reason: string;
  readonly content: string;
}

/**
 * The tests a designer proposes, one call of `propose_test` each, checked by the harness before they are
 * kept.
 *
 * @remarks
 * A test is refused when its path is already taken, its text does not parse as TypeScript, it imports
 * anything but `@playwright/test` or a relative path inside the test repository, imports another test,
 * holds an address of the configuration, or the proposal holds the value of a declared variable; then
 * when the check given finds something. Each refusal is journaled and told to the agent, every declared
 * value masked, so that it may propose again. The first `MAX_TESTS` accepted are kept; any later one is set
 * aside and journaled.
 */
export class TestProposals {
  private readonly rules: ProposalRules;
  private readonly journal: Journal;
  private readonly kept: AcceptedTest[] = [];
  private readonly forms: readonly string[];

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
        },
        required: ["application", "domain", "file", "reason", "content"],
        additionalProperties: false,
      },
      execute: async (args) => this.propose(args as Proposal),
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
    if (this.kept.length >= MAX_TESTS) {
      this.journal.record("info", `The test ${path} was set aside: ${MAX_TESTS} tests were already accepted.`);
      return `${MAX_TESTS} tests were already accepted; this one was set aside. Answer with one sentence; call no more tools.`;
    }
    const errors = await this.errors(path, proposal);
    if (errors.length > 0) return this.refuse(path, errors);
    this.kept.push({ path, application: proposal.application, domain: proposal.domain, reason: proposal.reason, content: proposal.content });
    this.journal.record("info", `The test ${path} was accepted.`);
    const count = this.kept.length;
    const next = count < MIN_TESTS ? `Propose at least ${MIN_TESTS - count} more.` : count < MAX_TESTS ? "You may propose one more, or answer with one sentence." : "Answer with one sentence; call no more tools.";
    return `The test ${path} was accepted (${count} of at most ${MAX_TESTS}). ${next}`;
  }

  private async errors(path: string, proposal: Proposal): Promise<string[]> {
    const { repositoryRoot, addresses, secrets, check } = this.rules;
    if (this.kept.some((test) => test.path === path) || existsSync(join(repositoryRoot, path))) return [`${path} is already taken; give the test another file name.`];
    const syntax = await moduleSyntax(proposal.content);
    if (!syntax.ok) return [`The test does not parse as TypeScript: ${syntax.error}.`];
    const errors = [
      ...importErrors(syntax.imports, join(repositoryRoot, path), repositoryRoot),
      ...addressErrors(proposal.content, addresses),
      ...secretValueErrors(`${proposal.reason}\n${proposal.content}`, secrets),
    ];
    if (errors.length > 0 || check === undefined) return errors;
    return [...(await check.check({ path, content: proposal.content }))];
  }

  private refuse(path: string, errors: readonly string[]): { error: string } {
    const masked = (text: string) => redactText(text, this.forms);
    for (const error of errors) this.journal.record("error", masked(`The test ${path} was refused: ${error}`));
    return { error: masked([`The test ${path} was refused. Fix it and propose it again.`, ...errors.map((error) => `- ${error}`)].join("\n")) };
  }
}
