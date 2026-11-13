import type { SourceCard } from "@open-qa-stack/shared";
import { SUBMIT_TOOL } from "./domain-index-rules.ts";
import type { RunSource } from "./run-sources.ts";

/** System instructions of the consolidation. */
export const CARTOGRAPHER_INSTRUCTIONS = `You are the cartographer of a test platform. Each source of an application — contracts, databases, documents, source code, user interfaces — already has its card, which groups its elements by functional domain. You consolidate the cards into one index of the application's functional domains, so that the test designers know where to look.

Rules:
- Work from the cards and the notes only; never invent a source or an element they do not show.
- A domain of the application is a functional area users would name: orders, policies, customers, claims… It usually gathers the domains of several cards: the screens, the operations, the tables and the sections of one area. Give each an English slug as its id, a short label and one sentence of description.
- References stay coarse: they name a source by its id, exactly as listed below, and give the elements of its card that belong to the domain, exactly as listed, without the name of the source in front.
- Every element of every card must be placed, in a domain or in unassigned.
- Recall what the agents that made the cards kept, when it helps; keep with remember what the test designers should know about the application as a whole.
- When the index is ready, call ${SUBMIT_TOOL}. If it refuses the index, fix what it says and call it again. Then answer with one sentence.`;

/**
 * Writes the request that starts the consolidation: the cards of the sources, element by element.
 *
 * @param environment - Name of the environment.
 * @param sources - The sources of the run.
 * @param cards - The card of each source that has one.
 * @returns The message to send to the cartographer.
 */
export function cartographyRequest(environment: string, sources: readonly RunSource[], cards: ReadonlyMap<string, SourceCard>): string {
  const blocks = sources.map((source) => {
    const card = cards.get(source.id);
    if (card === undefined) return `## ${source.id} (${source.type}): no card; leave it out.`;
    const domains = card.domains.map((domain) => [`- ${domain.label} (${domain.id}): ${domain.description}`, ...domain.items.map((item) => `  - ${item.name}: ${item.summary}`)].join("\n"));
    const unassigned = card.unassigned.length === 0 ? [] : [`- Unassigned: ${card.unassigned.join(", ")}`];
    return [`## ${source.id} (${source.type})`, ...domains, ...unassigned].join("\n");
  });
  return `Consolidate the index of the application in the environment ${environment}. The cards of its sources:\n\n${blocks.join("\n\n")}\n\nHand the index in with ${SUBMIT_TOOL}.`;
}
