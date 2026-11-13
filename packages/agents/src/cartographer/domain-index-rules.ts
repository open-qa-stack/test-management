import { placementErrors, unplacedItems, validateDomainSubmission, type DomainIndexSubmission, type IndexError, type SourceInventory, type SourceReferences } from "@open-qa-stack/shared";
import { secretErrors } from "../common/config-secrets.ts";
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
 * A submission is checked against its schema, then it must place every element of the cards and invent
 * none, refer to no source without a card and hold no secret outside the names of the sources and of the
 * elements of their cards, which come from the sources themselves. An item that is no element of its source but
 * becomes one without the name of the source and a slash or a colon in front is read without them, and the
 * references of a domain to one source are merged.
 *
 * @param inventory - The elements of the card of each source.
 * @param sources - Identifiers of every source of the run.
 * @param isRead - Whether a source has a card.
 * @param secrets - The secrets of the configuration, which no index may hold.
 * @returns The rules.
 */
export function domainIndexRules(inventory: SourceInventory, sources: ReadonlySet<string>, isRead: (source: string) => boolean, secrets: readonly string[]): SubmissionRules<DomainIndexSubmission> {
  return {
    tool: SUBMIT_TOOL,
    what: "index",
    secrets,
    description:
      "Hands in the domain index: the domains, each with coarse references into the sources, and in unassigned the elements you put in no domain. Every element of every card must appear once at least.",
    shape: SUBMISSION_SHAPE,
    validate: validateDomainSubmission,
    check: (valid) => {
      const value = normalised(valid, inventory);
      const errors = [...secretErrors(written(value, inventory), secrets), ...placementErrors(value, inventory, sources), ...unread(value, sources, isRead)];
      return { value, errors, unplaced: unplacedItems(value, inventory) };
    },
  };
}

/** What the agent wrote itself: the submission without the names of the sources and elements it was given. */
function written(submission: DomainIndexSubmission, inventory: SourceInventory): DomainIndexSubmission {
  const own = (references: readonly SourceReferences[]) =>
    references.map(({ source, items }) => (inventory.has(source) ? { source: "", items: items.map((item) => (inventory.get(source)!.includes(item) ? "" : item)) } : { source, items }));
  return { domains: submission.domains.map((domain) => ({ ...domain, references: own(domain.references) })), unassigned: own(submission.unassigned) };
}

/** References to sources of the run that have no card: the agent would have invented them. */
function unread(submission: DomainIndexSubmission, sources: ReadonlySet<string>, isRead: (source: string) => boolean): IndexError[] {
  const groups = [
    ...submission.domains.flatMap((domain, i) => domain.references.map((references, j) => [`/domains/${i}/references/${j}`, references.source] as const)),
    ...submission.unassigned.map((references, j) => [`/unassigned/${j}`, references.source] as const),
  ];
  return groups
    .filter(([, source]) => sources.has(source) && !isRead(source))
    .map(([path, source]) => ({ path: `${path}/source`, message: `${path}/source refers to ${source}, which has no card; leave it out.` }));
}

/**
 * Drops from each item that is no element of its source the name of the source, which a model sometimes
 * writes in front of it (`orders-db/public.orders`), and merges the references of a list to one source,
 * each item once.
 */
function normalised(submission: DomainIndexSubmission, inventory: SourceInventory): DomainIndexSubmission {
  return { domains: submission.domains.map((domain) => ({ ...domain, references: merged(domain.references, inventory) })), unassigned: merged(submission.unassigned, inventory) };
}

function merged(references: readonly SourceReferences[], inventory: SourceInventory): SourceReferences[] {
  const bySource = new Map<string, Set<string>>();
  for (const { source, items } of references) {
    const kept = bySource.get(source) ?? new Set<string>();
    const known = new Set(inventory.get(source));
    for (const item of items) kept.add(!known.has(item) && (item.startsWith(`${source}/`) || item.startsWith(`${source}:`)) ? item.slice(source.length + 1) : item);
    bySource.set(source, kept);
  }
  return [...bySource].map(([source, items]) => ({ source, items: [...items] }));
}
