import type { DomainIndexSubmission, IndexError } from "./types.ts";

/** What the harness read itself from some sources, without the model: contract tags and path prefixes, tables. */
export type SourceInventory = ReadonlyMap<string, readonly string[]>;

/**
 * Checks that a submission places what was read, and only that.
 *
 * @remarks
 * Every item of an inventoried source must appear in a domain or in `unassigned`, and every item a
 * submission gives for such a source must be one of its items, so that the index neither forgets nor
 * invents a tag or a table. References to sources that are not inventoried, such as interfaces or
 * documents, are free, but must name a source of the run.
 *
 * @param submission - What the agent handed in, already valid against its schema.
 * @param inventory - The items of each inventoried source.
 * @param sources - Identifiers of every source of the run.
 * @returns Every error found, each with its location; none when the submission places everything.
 */
export function placementErrors(submission: DomainIndexSubmission, inventory: SourceInventory, sources: ReadonlySet<string>): IndexError[] {
  const errors: IndexError[] = [];
  const groups = [
    ...submission.domains.flatMap((domain, i) => domain.references.map((references, j) => [`/domains/${i}/references/${j}`, references] as const)),
    ...submission.unassigned.map((references, j) => [`/unassigned/${j}`, references] as const),
  ];
  for (const [path, { source, items }] of groups) {
    if (!sources.has(source)) {
      errors.push({ path: `${path}/source`, message: `${path}/source names ${source}, which is not a source of this run.` });
      continue;
    }
    const known = inventory.get(source);
    items.forEach((item, k) => {
      if (known !== undefined && !known.includes(item)) errors.push({ path: `${path}/items/${k}`, message: `${path}/items/${k}: ${item} is not an item of ${source}; use one of the items listed for it.` });
    });
  }
  for (const [source, items] of unplacedItems(submission, inventory)) {
    for (const item of items) errors.push({ path: "", message: `${item} of ${source} is in no domain nor in unassigned.` });
  }
  return errors;
}

/**
 * Lists, by source, the items a submission still has to place.
 *
 * @param submission - What the agent handed in, already valid against its schema.
 * @param inventory - The items of each inventoried source.
 * @returns The sources that have items in no domain nor in `unassigned`, each with those items, in the order of the inventory.
 */
export function unplacedItems(submission: DomainIndexSubmission, inventory: SourceInventory): Map<string, string[]> {
  const placed = new Set([...submission.domains.flatMap((domain) => domain.references), ...submission.unassigned].flatMap(({ source, items }) => items.map((item) => `${source}\u0000${item}`)));
  const unplaced = new Map<string, string[]>();
  for (const [source, items] of inventory) {
    const missing = items.filter((item) => !placed.has(`${source}\u0000${item}`));
    if (missing.length > 0) unplaced.set(source, missing);
  }
  return unplaced;
}
