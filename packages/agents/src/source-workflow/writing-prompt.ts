import type { KnowledgeBaseSourceType, ManifestDomain } from "@open-qa-stack/domain";
import type { ExportedElement } from "@open-qa-stack/tools";
import { MAX_DOMAIN_FILE_LENGTH } from "./domain-file-control.ts";
import { batchSummary } from "./element-batches.ts";
import { sourceWords } from "./source-words.ts";
import { promptOf, type PromptTemplate, type PromptValues } from "../common/prompt-template.ts";

/** The prompt of the writing of the file of one domain of one source, with how the source names its elements and how long the file may be. */
export const WRITING_PROMPT = {
  template: `You document one functional domain of one source of an application — {{elements}} — for the agents that write tests. They read your file to know which element to read and how; they open the raw definitions only when your file is not enough.

Rules:
- Answer with the markdown body of the file and nothing else: no title, no code fence around it. The title is written for you.
- Name every element of the domain at least once, exactly as the request writes it, between backticks: {{cited}}.
- Say only what the request shows. Never invent an element, a name or a value: a name written in code that the source does not have is refused.
- {{in_code}}
- A useful file has {{useful}}. Leave out a part you have nothing to say about.
- Write under {{max_length}} characters.
- Keep with remember what the agents after you should know and no element says by itself, such as a rule several elements share or a name the team uses its own way. Not everything: a few facts that matter.`,
  variables: ["elements", "cited", "in_code", "useful", "max_length"],
} as const satisfies PromptTemplate;

/**
 * What each variable of the prompt of the writer of the file of a domain stands for in a session.
 *
 * @param type - What the source is, which names its elements.
 * @returns The value of each variable.
 */
export function writingValues(type: KnowledgeBaseSourceType): PromptValues<typeof WRITING_PROMPT> {
  const words = sourceWords(type);
  return {
    elements: words.elements,
    cited: words.cited,
    in_code: words.inCode,
    useful: words.useful,
    max_length: String(MAX_DOMAIN_FILE_LENGTH),
  };
}

/**
 * System instructions of the writing of the file of one domain of one source.
 *
 * @param type - What the source is, which names its elements.
 * @returns The instructions.
 */
export function writingInstructions(type: KnowledgeBaseSourceType): string {
  return promptOf(WRITING_PROMPT, writingValues(type));
}

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
