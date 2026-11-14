import type { ManifestDomain } from "@open-qa-stack/shared";
import type { ExportedElement } from "@open-qa-stack/tools";
import { MAX_DOMAIN_FILE_LENGTH } from "./domain-file-control.ts";
import { batchSummary } from "./element-batches.ts";

/** System instructions of the writing of the file of one domain of one source. */
export const WRITING_INSTRUCTIONS = `You document one functional domain of one source of an application — tables, views and routines of a database — for the agents that write tests. They read your file to know which element to read and how; they open the raw definitions only when your file is not enough.

Rules:
- Answer with the markdown body of the file and nothing else: no title, no code fence around it. The title is written for you.
- Name every element of the domain at least once, exactly as the request writes it, between backticks: \`public.orders\`.
- Say only what the request shows. Never invent an element, a column or a value.
- A useful file has a table of the elements with their role, the columns worth searching or filtering on, how the elements link to each other and to the other domains, and a few hints on how to use them. Leave out a part you have nothing to say about.
- Write in English, under ${MAX_DOMAIN_FILE_LENGTH} characters.`;

/**
 * Writes the request of the file of one domain: the domain, its elements with their role and summary, and
 * the other domains of the source.
 *
 * @param sourceId - Identifier of the source.
 * @param domain - The domain.
 * @param members - Its elements, each with its role.
 * @param others - The other domains of the source.
 * @returns The message that starts the session of the file.
 */
export function domainRequest(
  sourceId: string,
  domain: ManifestDomain,
  members: readonly { readonly element: ExportedElement; readonly role: string }[],
  others: readonly ManifestDomain[],
): string {
  const elements = members.map(({ element, role }) => [`### ${element.name} — ${role}`, batchSummary(element)].join("\n"));
  const elsewhere = others.map((other) => `- ${other.id} — ${other.label}: ${other.description}`);
  return [
    `Write the file of the domain ${domain.id} of the source ${sourceId}.`,
    `${domain.label}: ${domain.description}`,
    `Its ${members.length} elements, each named by its ### line, with its role:`,
    ...elements,
    elsewhere.length === 0 ? "The source has no other domain." : `The other domains of the source:\n${elsewhere.join("\n")}`,
    "Answer with the markdown body alone.",
  ].join("\n\n");
}
