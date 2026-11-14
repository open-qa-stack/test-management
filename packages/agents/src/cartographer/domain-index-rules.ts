import {
  placementErrors,
  unplacedItems,
  validateDomainSubmission,
  type DomainIndexSubmission,
  type IndexError,
  type IndexSourceType,
  type SourceCard,
  type SourceInventory,
  type SourceReferences,
} from "@open-qa-stack/shared";
import { secretErrors } from "../common/config-secrets.ts";
import { withUnassigned } from "../common/with-unassigned.ts";
import type { FollowUp, SubmissionCheck, SubmissionRules } from "../common/handed-in.ts";
import { ElementWords, type SourceElement } from "./element-words.ts";
import { isStructureSection } from "./structure-sections.ts";

/** Name of the tool the cartographer hands its index in with. */
export const SUBMIT_TOOL = "submit_index";

const references = {
  type: "object",
  properties: { source: { type: "string", description: "Identifier of the source." }, items: { type: "array", items: { type: "string" } } },
} as const;

/** What the elements of a domain are, by the type of their source, for messages. */
const KINDS: Readonly<Record<IndexSourceType, string>> = {
  openapi: "operations of contracts",
  postgresql: "tables",
  document: "sections of documents",
  "source-code": "folders of source code",
  web: "screens",
};

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
 * A submission without `unassigned` puts nothing there. It is checked against its schema, then it must place every element of the cards and invent
 * none, refer to no source without a card and hold no secret. An item that is no element of its source but
 * becomes one without the name of the source and a slash or a colon in front is read without them; one that
 * is still none but is the id or the label of a domain of the card of its source is read as the elements of
 * that domain the submission names nowhere else for that source, when there are any; and the references of a domain to one
 * source are merged.
 *
 * Each domain must be a functional area: one whose elements are all of one type of source is refused when
 * another domain holds an element of another source that shares a word with one of them, and one made of
 * sections of the structure of documents only is refused. An element is in a domain or in `unassigned`, never
 * in both. Once a submission is accepted, each element it left in `unassigned` that a domain of its card
 * holds whose id or label is that of a domain of the index goes to that domain, unless it is a section of
 * the structure of a document or the index would then break these rules, and the journal names it. The
 * elements still in `unassigned` are asked again, in a second
 * submission limited to them, after the domains of the index, each with the domain of its card that holds
 * it, what the card says it holds, and the domains of the index that share a word with it: it puts them in domains of the
 * index, repeating their id, label and description, or in new ones, and is merged into the first. The
 * elements the first placed in a domain are left out of the second, which may hand them in again; each
 * error names the place of the element in the second as it was handed in.
 *
 * @param inventory - The elements of the card of each source.
 * @param sources - The type of every source of the run, by its identifier.
 * @param isRead - Whether a source has a card.
 * @param secrets - The secrets of the configuration, which no index may hold.
 * @param cards - The card of each source that has one, which tells the second submission what each element is.
 * @returns The rules.
 */
export function domainIndexRules(
  inventory: SourceInventory,
  sources: ReadonlyMap<string, IndexSourceType>,
  isRead: (source: string) => boolean,
  secrets: readonly string[],
  cards: ReadonlyMap<string, SourceCard>,
): SubmissionRules<DomainIndexSubmission> {
  const ids = new Set(sources.keys());
  const words = new ElementWords(inventory, sources);
  const checked = (
    value: DomainIndexSubmission,
    placed: DomainIndexSubmission,
    filed: DomainIndexSubmission,
    touched?: ReadonlySet<string>,
  ): SubmissionCheck<DomainIndexSubmission> => ({
    value: filed,
    errors: [
      ...secretErrors(value, secrets),
      ...placementErrors(placed, inventory, ids),
      ...unread(value, ids, isRead),
      ...filingErrors(filed, sources, words, touched),
    ],
    unplaced: unplacedItems(placed, inventory),
  });
  return {
    tool: SUBMIT_TOOL,
    what: "index",
    secrets,
    description:
      "Hands in the domain index: the domains, each with coarse references into the sources, and in unassigned the elements you put in no domain. Every element of every card must appear once at least.",
    shape: SUBMISSION_SHAPE,
    validate: (args) => validateDomainSubmission(withUnassigned(args)),
    check: (valid) => {
      const value = normalised(valid, inventory, cards);
      const result = checked(value, value, value);
      if (result.errors.length > 0) return result;
      const { filed, moved } = filedByCard(value, sources, cards);
      if (moved.length === 0) return result;
      const again = checked(filed, filed, filed);
      if (again.errors.length > 0) return result;
      return {
        ...again,
        note: `The harness put in the domain of the index named as a domain of their card these elements left in unassigned: ${moved.join(", ")}.`,
      };
    },
    leaveAside: (value, unplaced) => ({
      ...value,
      unassigned: grouped([...value.unassigned, ...[...unplaced].map(([source, items]) => ({ source, items: [...items] }))]),
    }),
    followUp: (accepted) => {
      const left = new Map([...inventory].map(([source, items]) => [source, items.filter((item) => !placedIn(accepted.domains, source, item))] as const));
      const lines = [...left].flatMap(([source, items]) =>
        items.map((item) => `- ${source}: ${item}${described(cards.get(source), item)}${echoes(accepted, { source, item }, words)}`),
      );
      if (lines.length === 0) return undefined;
      return {
        request: [
          `It leaves in unassigned the elements below. Call ${SUBMIT_TOOL} once more with only them: put each in the domain of the index it belongs to, repeating its id, label and description, or in a new domain, and keep in unassigned only those that belong to none. If none belongs to a domain, answer with one sentence instead.`,
          "The domains of the index:",
          ...accepted.domains.map((domain) => `- ${domain.id} (${domain.label}): ${domain.description}`),
          "The elements left, each with the domain of its card and what it holds:",
          ...lines,
        ].join("\n"),
        asked: `The index leaves ${lines.length} of its ${[...inventory.values()].flat().length} elements in unassigned; a second submission limited to them was asked.`,
        check: (valid) => {
          const value = normalised(valid, inventory, cards);
          const filed = withoutPlaced(value, accepted);
          return checked(value, withPlaced(value, accepted), merged(accepted, filed), new Set(filed.domains.map((domain) => domain.id)));
        },
      } satisfies FollowUp<DomainIndexSubmission>;
    },
  };
}

/**
 * An accepted submission with each element it left in `unassigned` placed in every domain of the index that
 * has the id or the label of a domain of its card holding it, but a section of the structure of a document,
 * and what the journal says of each such element.
 */
function filedByCard(
  submission: DomainIndexSubmission,
  sources: ReadonlyMap<string, IndexSourceType>,
  cards: ReadonlyMap<string, SourceCard>,
): { filed: DomainIndexSubmission; moved: string[] } {
  const named = (one: string, other: string) => one.trim().toLowerCase() === other.trim().toLowerCase();
  const homes = ({ source, item }: SourceElement) => {
    if (sources.get(source) === "document" && isStructureSection(item)) return [];
    const own = cards.get(source)?.domains.filter((domain) => domain.items.some((element) => element.name === item)) ?? [];
    return submission.domains.filter((domain) => own.some((card) => named(card.id, domain.id) || named(card.label, domain.label)));
  };
  const placed = submission.unassigned.flatMap(({ source, items }) => items.map((item) => ({ source, item, homes: homes({ source, item }) })));
  const moving = placed.filter((element) => element.homes.length > 0);
  const domains = submission.domains.map((domain) => {
    const added = moving.filter((element) => element.homes.includes(domain)).map(({ source, item }) => ({ source, items: [item] }));
    return added.length === 0 ? domain : { ...domain, references: grouped([...domain.references, ...added]) };
  });
  const unassigned = submission.unassigned
    .map(({ source, items }) => ({ source, items: items.filter((item) => !moving.some((element) => element.source === source && element.item === item)) }))
    .filter(({ items }) => items.length > 0);
  return {
    filed: { domains, unassigned },
    moved: moving.map(({ source, item, homes }) => `${source}: ${item} in ${homes.map((domain) => domain.id).join(" and ")}`),
  };
}

/** Whether an element is placed in one of the domains. */
function placedIn(domains: DomainIndexSubmission["domains"], source: string, item: string): boolean {
  return domains.some((domain) => domain.references.some((references) => references.source === source && references.items.includes(item)));
}

/**
 * A second submission without the elements the first placed in a domain, which a model may hand in again
 * with the rest of the index: what was accepted stays as it was. A domain left with nothing is dropped.
 */
function withoutPlaced(second: DomainIndexSubmission, accepted: DomainIndexSubmission): DomainIndexSubmission {
  const left = (references: readonly SourceReferences[]) =>
    references
      .map(({ source, items }) => ({ source, items: items.filter((item) => !placedIn(accepted.domains, source, item)) }))
      .filter(({ items }) => items.length > 0);
  const domains = second.domains.map((domain) => ({ ...domain, references: left(domain.references) })).filter((domain) => domain.references.length > 0);
  return { domains, unassigned: left(second.unassigned) };
}

/**
 * A second submission with what the first placed in a domain added after its own unassigned, so that it is
 * checked against every element of the cards, each error at the place the second gives it.
 */
function withPlaced(second: DomainIndexSubmission, accepted: DomainIndexSubmission): DomainIndexSubmission {
  return { domains: second.domains, unassigned: [...second.unassigned, ...accepted.domains.flatMap((domain) => domain.references)] };
}

/** The domain of its card that holds an element and what the card says it holds, for the line that names it; nothing for an element the card left unassigned. */
function described(card: SourceCard | undefined, item: string): string {
  const domain = card?.domains.find((candidate) => candidate.items.some((element) => element.name === item));
  if (domain === undefined) return "";
  return ` (card domain ${domain.label}): ${domain.items.find((element) => element.name === item)!.summary}`;
}

/** The domains of an index that share a word with an element, for the line that names it. */
function echoes(index: DomainIndexSubmission, element: SourceElement, words: ElementWords): string {
  const domains = index.domains.filter((domain) => elementsOf(domain).some((other) => words.shared(element, other).length > 0)).map((domain) => domain.id);
  return domains.length === 0 ? "" : ` — shares words with the domains ${domains.join(", ")}`;
}

/** The first submission accepted, with the domains of the second merged into it, and its unassigned. */
function merged(accepted: DomainIndexSubmission, second: DomainIndexSubmission): DomainIndexSubmission {
  const extended = accepted.domains.map((domain) => {
    const more = second.domains.find((candidate) => candidate.id === domain.id);
    return more === undefined ? domain : { ...domain, references: grouped([...domain.references, ...more.references]) };
  });
  const added = second.domains.filter((domain) => !accepted.domains.some((candidate) => candidate.id === domain.id));
  return { domains: [...extended, ...added], unassigned: second.unassigned };
}

/**
 * Domains that are no functional area, and elements both in a domain and in unassigned.
 *
 * @param touched - The domains to check, when not all of them: a domain the first submission made stays as it was accepted.
 */
function filingErrors(
  submission: DomainIndexSubmission,
  sources: ReadonlyMap<string, IndexSourceType>,
  words: ElementWords,
  touched?: ReadonlySet<string>,
): IndexError[] {
  const errors: IndexError[] = [];
  submission.domains.forEach((domain, i) => {
    if (touched !== undefined && !touched.has(domain.id)) return;
    const own = elementsOf(domain);
    const kind = sources.get(own[0]!.source);
    if (kind === undefined || own.some((element) => sources.get(element.source) !== kind)) return;
    if (kind === "document" && own.every((element) => isStructureSection(element.item))) {
      errors.push({
        path: `/domains/${i}`,
        message: `The domain ${domain.id} holds only sections of the structure of documents (purpose, scope, acceptance criteria, open points…), which are no functional area; put each in the domain it is about, or in unassigned.`,
      });
      return;
    }
    for (const other of submission.domains) {
      const shared = other === domain ? [] : [...new Set(elementsOf(other).flatMap((theirs) => own.flatMap((element) => words.shared(element, theirs))))];
      if (shared.length === 0) continue;
      errors.push({
        path: `/domains/${i}`,
        message: `The domain ${domain.id} holds only ${KINDS[kind]}, although the domain ${other.id} shares words with them (${shared.join(", ")}); put each in the domain of its functional area.`,
      });
      return;
    }
  });
  submission.unassigned.forEach(({ source, items }, j) => {
    items.forEach((item, k) => {
      if (placedIn(submission.domains, source, item))
        errors.push({ path: `/unassigned/${j}/items/${k}`, message: `${item} of ${source} is both in a domain and in unassigned; it is one or the other.` });
    });
  });
  return errors;
}

/** The elements a domain refers to. */
function elementsOf(domain: DomainIndexSubmission["domains"][number]): SourceElement[] {
  return domain.references.flatMap(({ source, items }) => items.map((item) => ({ source, item })));
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
 * writes in front of it (`orders-db/public.orders`), reads an item that is still none but is the id or the
 * label of a domain of the card of its source as the elements of that domain the submission names nowhere
 * for that source, when there are any, which a model writes when it takes the domain of a card for an
 * element, and merges the
 * references of a list to one source, each item once.
 */
function normalised(submission: DomainIndexSubmission, inventory: SourceInventory, cards: ReadonlyMap<string, SourceCard>): DomainIndexSubmission {
  const written = (source: string) =>
    new Set(
      [...submission.domains.flatMap((domain) => domain.references), ...submission.unassigned].flatMap((references) =>
        references.source === source ? references.items : [],
      ),
    );
  const asItems = (references: readonly SourceReferences[]) =>
    grouped(
      references.map(({ source, items }) => {
        const known = new Set(inventory.get(source));
        const element = (item: string) =>
          !known.has(item) && (item.startsWith(`${source}/`) || item.startsWith(`${source}:`)) ? item.slice(source.length + 1) : item;
        const elements = (item: string) => {
          const domain = known.has(item) ? undefined : cards.get(source)?.domains.find((candidate) => candidate.id === item || candidate.label === item);
          const left = domain?.items.map((named) => named.name).filter((name) => !written(source).has(name)) ?? [];
          return left.length === 0 ? [item] : left;
        };
        return { source, items: items.map(element).flatMap(elements) };
      }),
    );
  return {
    domains: submission.domains.map((domain) => ({ ...domain, references: asItems(domain.references) })),
    unassigned: asItems(submission.unassigned),
  };
}

/** The references of a list merged by source, each item once. */
function grouped(references: readonly SourceReferences[]): SourceReferences[] {
  const bySource = new Map<string, Set<string>>();
  for (const { source, items } of references) bySource.set(source, new Set([...(bySource.get(source) ?? []), ...items]));
  return [...bySource].map(([source, items]) => ({ source, items: [...items] }));
}
