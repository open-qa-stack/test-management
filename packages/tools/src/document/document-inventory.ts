import type { SourceInventory } from "../common/source-inventory.ts";
import { documentExport, namedSections } from "./document-export.ts";
import { documentSections } from "./document-sections.ts";

/**
 * Reads what a document holds, without the model.
 *
 * @remarks
 * The document is read as Markdown, the one format read so far: `documentSections` is its reader, and what
 * follows works on the sections any reader gives. The elements are the sections of its export, those of its
 * two highest levels, each under its name. The facts of each are its number, which the read tool asks for,
 * and its level. The fingerprint is that of the export.
 *
 * @param markdown - The document.
 * @returns The inventory of the document, with its export.
 */
export function documentInventory(markdown: string): SourceInventory {
  const sections = documentSections(markdown);
  const exported = documentExport(sections);
  const named = namedSections(sections);
  return {
    items: named.map(({ name }) => name),
    facts: new Map(named.map(({ name, section }) => [name, { number: section.number, level: section.level }])),
    fingerprint: exported.fingerprint,
    export: exported,
  };
}
