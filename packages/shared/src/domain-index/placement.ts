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
  const placed = new Map<string, Set<string>>();
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
      placed.set(source, (placed.get(source) ?? new Set()).add(item));
    });
  }
  for (const [source, items] of inventory) {
    for (const item of items) {
      if (!placed.get(source)?.has(item)) errors.push({ path: "", message: `${item} of ${source} is in no domain nor in unassigned.` });
    }
  }
  return errors;
}
