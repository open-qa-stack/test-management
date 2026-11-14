import type { SourceInventory } from "../common/source-inventory.ts";
import type { DocumentSet } from "./document-set.ts";

/**
 * Reads what a source of documents holds, without the model.
 *
 * @remarks
 * The elements are its documents, each by its path, with its title, its number of headings and its length
 * as facts. What an agent makes of them — which document, which section is worth an element of its own — is
 * for the agent that maps the source to say. The fingerprint is that of the paths and the texts.
 *
 * @param documents - The documents of the source.
 * @returns The inventory of the source.
 * @throws Error when the source does not exist.
 */
export async function documentInventory(documents: DocumentSet): Promise<SourceInventory> {
  const listing = await documents.list();
  return {
    items: listing.files.map((file) => file.path),
    facts: new Map(listing.files.map(({ path, ...facts }) => [path, facts])),
    fingerprint: await documents.fingerprint(),
    ...(listing.truncated ? { truncated: true } : {}),
  };
}
