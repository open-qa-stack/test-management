import type { ToolDefinition } from "@open-qa-stack/domain";
import { placementErrors, validateDomainSubmission, type DomainIndexSubmission, type IndexError, type SourceInventory } from "@open-qa-stack/shared";
import type { Journal } from "./journal.ts";

/** Name of the tool the cartographer hands its index in with. */
export const SUBMIT_TOOL = "submit_index";
/** Most errors told to the agent at once. */
const MAX_TOLD_ERRORS = 30;

const references = {
  type: "object",
  properties: { source: { type: "string", description: "Identifier of the source." }, items: { type: "array", items: { type: "string" } } },
} as const;

/**
 * The shape of a submission, given to the model to write one. Its rules are left to the harness, so that
 * every refusal is journaled and explained the same way.
 */
const SUBMISSION_SHAPE = {
  type: "object",
  properties: {
    domains: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "An English slug: lower case letters and digits, separated by hyphens." },
          label: { type: "string" },
          description: { type: "string", description: "One sentence." },
          references: { type: "array", items: references },
        },
      },
    },
    unassigned: { type: "array", items: references, description: "What you read but put in no domain." },
  },
} as const;

/**
 * The index the cartographer hands in, checked before it is kept.
 *
 * @remarks
 * The agent calls `submit_index` with its domains and what it put in none. The harness checks the
 * submission against its schema, then that it places every tag and table read and invents none, and that
 * it refers to no source the agent has not read yet; a refused submission is journaled and its errors told
 * to the agent, which may submit again while its limits allow. Only the first accepted submission is kept.
 */
export class IndexSubmission {
  private readonly inventory: SourceInventory;
  private readonly sources: ReadonlySet<string>;
  private readonly journal: Journal;
  private readonly isRead: (source: string) => boolean;
  private kept: DomainIndexSubmission | undefined;

  /**
   * @param inventory - The items of each inventoried source.
   * @param sources - Identifiers of every source of the run.
   * @param journal - Where refusals and the acceptance are written.
   * @param isRead - Whether a source has been read so far.
   */
  public constructor(inventory: SourceInventory, sources: ReadonlySet<string>, journal: Journal, isRead: (source: string) => boolean) {
    this.inventory = inventory;
    this.sources = sources;
    this.journal = journal;
    this.isRead = isRead;
  }

  /**
   * The submission accepted, if any.
   *
   * @returns It, or `undefined` when none was.
   */
  public get accepted(): DomainIndexSubmission | undefined {
    return this.kept;
  }

  /**
   * The tool the agent hands its index in with.
   *
   * @returns The tool.
   */
  public tool(): ToolDefinition {
    return {
      name: SUBMIT_TOOL,
      description:
        "Hands in the domain index: the domains, each with coarse references into the sources, and in unassigned what you read but put in no domain. Every tag and table listed for a contract or a base must appear once at least. Call it once your exploration is done.",
      parameters: SUBMISSION_SHAPE,
      execute: async (args) => this.submit(args),
    };
  }

  private submit(args: unknown): string | { error: string } {
    if (this.kept !== undefined) return "An index was already accepted; there is nothing more to do.";
    const validation = validateDomainSubmission(args);
    if (!validation.ok) return this.refuse(validation.errors);
    const errors = [...placementErrors(validation.value, this.inventory, this.sources), ...this.unread(validation.value)];
    if (errors.length > 0) return this.refuse(errors);
    this.kept = validation.value;
    this.journal.record("info", "The index was accepted.");
    return "The index was accepted. Answer with one sentence that sums up the domains; call no more tools.";
  }

  /** References to sources of the run that the agent has not read: it would have invented them. */
  private unread(submission: DomainIndexSubmission): IndexError[] {
    const groups = [
      ...submission.domains.flatMap((domain, i) => domain.references.map((references, j) => [`/domains/${i}/references/${j}`, references.source] as const)),
      ...submission.unassigned.map((references, j) => [`/unassigned/${j}`, references.source] as const),
    ];
    return groups
      .filter(([, source]) => this.sources.has(source) && !this.isRead(source))
      .map(([path, source]) => ({ path: `${path}/source`, message: `${path}/source refers to ${source}, which you have not read; read it first, or leave it out.` }));
  }

  private refuse(errors: readonly IndexError[]): { error: string } {
    for (const error of errors) this.journal.record("error", `The index was refused: ${error.message}`);
    const told = errors.slice(0, MAX_TOLD_ERRORS).map((error) => `- ${error.message}`);
    const more = errors.length > MAX_TOLD_ERRORS ? [`- and ${errors.length - MAX_TOLD_ERRORS} more`] : [];
    return { error: `The index was refused. Fix it and submit it again:\n${[...told, ...more].join("\n")}` };
  }
}
