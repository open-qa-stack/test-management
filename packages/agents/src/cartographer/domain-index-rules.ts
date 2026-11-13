import { placementErrors, unplacedItems, validateDomainSubmission, type DomainIndexSubmission, type IndexError, type SourceInventory, type SourceReferences } from "@open-qa-stack/shared";
import type { SubmissionRules } from "../common/handed-in.ts";

/** Name of the tool the cartographer hands its index in with. */
export const SUBMIT_TOOL = "submit_index";

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
 * How the cartographer hands its domain index in.
 *
 * @remarks
 * A submission is checked against its schema, then it must place every tag and table read and invent
 * none, and refer to no source the agent has not read yet. An item written after the name of its source
 * and a slash or a colon is read without it, and the references of a domain to one source are merged.
 *
 * @param inventory - The items of each inventoried source.
 * @param sources - Identifiers of every source of the run.
 * @param isRead - Whether a source has been read so far.
 * @returns The rules.
 */
export function domainIndexRules(inventory: SourceInventory, sources: ReadonlySet<string>, isRead: (source: string) => boolean): SubmissionRules<DomainIndexSubmission> {
  return {
    tool: SUBMIT_TOOL,
    what: "index",
    description:
      "Hands in the domain index: the domains, each with coarse references into the sources, and in unassigned what you read but put in no domain. Every tag and table listed for a contract or a base must appear once at least. Call it once your exploration is done.",
    shape: SUBMISSION_SHAPE,
    validate: validateDomainSubmission,
    check: (valid) => {
      const value = normalised(valid);
      const errors = [...placementErrors(value, inventory, sources), ...unread(value, sources, isRead)];
      return { value, errors, unplaced: unplacedItems(value, inventory) };
    },
  };
}

/** References to sources of the run that the agent has not read: it would have invented them. */
function unread(submission: DomainIndexSubmission, sources: ReadonlySet<string>, isRead: (source: string) => boolean): IndexError[] {
  const groups = [
    ...submission.domains.flatMap((domain, i) => domain.references.map((references, j) => [`/domains/${i}/references/${j}`, references.source] as const)),
    ...submission.unassigned.map((references, j) => [`/unassigned/${j}`, references.source] as const),
  ];
  return groups
    .filter(([, source]) => sources.has(source) && !isRead(source))
    .map(([path, source]) => ({ path: `${path}/source`, message: `${path}/source refers to ${source}, which you have not read; read it first, or leave it out.` }));
}

/**
 * Drops from each item the name of its source, which a model sometimes writes in front of it
 * (`orders-db/public.orders`), and merges the references of a list to one source, each item once.
 */
function normalised(submission: DomainIndexSubmission): DomainIndexSubmission {
  return { domains: submission.domains.map((domain) => ({ ...domain, references: merged(domain.references) })), unassigned: merged(submission.unassigned) };
}

function merged(references: readonly SourceReferences[]): SourceReferences[] {
  const bySource = new Map<string, Set<string>>();
  for (const { source, items } of references) {
    const kept = bySource.get(source) ?? new Set<string>();
    for (const item of items) kept.add(item.startsWith(`${source}/`) || item.startsWith(`${source}:`) ? item.slice(source.length + 1) : item);
    bySource.set(source, kept);
  }
  return [...bySource].map(([source, items]) => ({ source, items: [...items] }));
}
