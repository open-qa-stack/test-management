import type { SourceCard, SourceManifest } from "@open-qa-stack/shared";
import type { SourceInventory } from "@open-qa-stack/tools";

/**
 * Derives the card of a source from its manifest, for the agents that read cards.
 *
 * @remarks
 * The card holds the elements of the inventory only — the tables and views of a database, not its
 * routines; the operations of a contract, not its schemas; every element the agent chose of documents. A domain of the manifest that holds one of them is a domain of the card, the role of each
 * element as its summary; the elements set aside or left unplaced are `unassigned`. The card is `complete`
 * when the manifest is.
 *
 * @param manifest - The manifest of the source.
 * @param inventory - The inventory of the source, with the facts of each element.
 * @param run - What the sessions of the source used.
 * @param model - The model used.
 * @param producedAt - When the card is made.
 * @returns The card.
 */
export function manifestCard(
  manifest: SourceManifest,
  inventory: SourceInventory,
  run: SourceCard["run"],
  model: SourceCard["model"],
  producedAt: Date,
): SourceCard {
  const elements = new Map(manifest.elements.map((element) => [element.name, element]));
  const domains = manifest.domains.map(({ id, label, description }) => ({
    id,
    label,
    description,
    items: inventory.items.flatMap((name) => {
      const element = elements.get(name)!;
      return element.domain === id ? [{ name, summary: element.role!, facts: { ...inventory.facts.get(name) } }] : [];
    }),
  }));
  return {
    formatVersion: 1,
    source: manifest.source,
    fingerprint: manifest.fingerprint,
    producedAt: producedAt.toISOString(),
    model,
    run,
    status: manifest.status === "complete" ? "complete" : "truncated",
    domains: domains.filter((domain) => domain.items.length > 0),
    unassigned: inventory.items.filter((name) => elements.get(name)!.domain === undefined),
  };
}
