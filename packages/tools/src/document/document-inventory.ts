import { fingerprintOf } from "../common/fingerprint.ts";
import type { SourceInventory } from "../common/source-inventory.ts";
import { documentSections } from "./document-sections.ts";

/**
 * Reads what a document holds, without the model.
 *
 * @remarks
 * The elements are its sections of the two highest levels it has — chapters and their sections, whether
 * the document starts at `#` or at `##`. Each is named by its title; a title that comes back is followed by
 * its number, as `Overview (§7)`, so that every name is unique. The facts of each are its number, which the
 * read tool asks for, and its level. The fingerprint covers the whole text.
 *
 * @param markdown - The document.
 * @returns The inventory of the document.
 */
export function documentInventory(markdown: string): SourceInventory {
  const sections = documentSections(markdown);
  const levels = [...new Set(sections.map((section) => section.level))].sort().slice(0, 2);
  const kept = sections.filter((section) => levels.includes(section.level));
  const repeated = new Set(kept.filter((section, i) => kept.findIndex((other) => other.title === section.title) !== i).map((section) => section.title));
  const named = kept.map((section) => [repeated.has(section.title) ? `${section.title} (§${section.number})` : section.title, section] as const);
  return {
    items: named.map(([name]) => name),
    facts: new Map(named.map(([name, { number, level }]) => [name, { number, level }])),
    fingerprint: fingerprintOf(markdown),
  };
}
