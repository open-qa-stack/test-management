import type { SourceCard, SourceInventory } from "@open-qa-stack/shared";
import { SUBMIT_TOOL } from "./domain-index-rules.ts";
import { ElementWords } from "./element-words.ts";
import type { RunSource } from "./run-sources.ts";

/** System instructions of the consolidation. */
export const CARTOGRAPHER_INSTRUCTIONS = `You are the cartographer of a test platform. Each source of an application — contracts, databases, documents, source code, user interfaces — already has its card, which groups its elements by functional domain. You consolidate the cards into one index of the application's functional domains, so that the test designers know where to look.

Rules:
- Work from the cards and the notes only; never invent a source or an element they do not show.
- A domain of the application is a functional area users would name: orders, policies, customers, claims… It usually gathers the domains of several cards: the screens, the operations, the tables and the sections of one area. Give each an English slug as its id, a short label and one sentence of description.
- A domain is never a kind of source, such as all the screens or all the tables, nor a part of the structure of a document, such as its purpose, its scope, its acceptance criteria or its open points.
- An element that shares words with domains of other cards, as the cards below say, most often belongs with their elements.
- References stay coarse: they name a source by its id, exactly as listed below, and give the elements of its card that belong to the domain, exactly as listed, without the name of the source in front.
- Every element of every card must be placed, in a domain or in unassigned, never in both.
- Recall what the agents that made the cards kept, when it helps; keep with remember what the test designers should know about the application as a whole.
- When the index is ready, call ${SUBMIT_TOOL}. If it refuses the index, fix what it says and call it again. Then answer with one sentence.`;

/**
 * Writes the request that starts the consolidation: the cards of the sources, element by element.
 *
 * @remarks
 * Each element is followed by the domains of the other cards that hold an element sharing a word with it,
 * as `source › domain`, so that the model sees what goes together without reading every card side by side.
 *
 * @param environment - Name of the environment.
 * @param sources - The sources of the run.
 * @param cards - The card of each source that has one.
 * @param inventory - The elements of each card.
 * @returns The message to send to the cartographer.
 */
export function cartographyRequest(
  environment: string,
  sources: readonly RunSource[],
  cards: ReadonlyMap<string, SourceCard>,
  inventory: SourceInventory,
): string {
  const words = new ElementWords(inventory, new Map([...cards].map(([id, card]) => [id, card.source.type] as const)));
  const echoes = (source: string, item: string) => {
    const domains = [...cards].flatMap(([other, card]) =>
      card.domains
        .filter((domain) => domain.items.some(({ name }) => words.shared({ source, item }, { source: other, item: name }).length > 0))
        .map((domain) => `${other} › ${domain.id}`),
    );
    return domains.length === 0 ? "" : ` — shares words with ${domains.join(", ")}`;
  };
  const blocks = sources.map((source) => {
    const card = cards.get(source.id);
    if (card === undefined) return `## ${source.id} (${source.type}): no card; leave it out.`;
    const domains = card.domains.map((domain) =>
      [
        `- ${domain.label} (${domain.id}): ${domain.description}`,
        ...domain.items.map((item) => `  - ${item.name}: ${item.summary}${echoes(source.id, item.name)}`),
      ].join("\n"),
    );
    const echoing = card.unassigned.flatMap((item) => {
      const echo = echoes(source.id, item);
      return echo === "" ? [] : [`  - ${item}${echo}`];
    });
    const unassigned = card.unassigned.length === 0 ? [] : [`- Unassigned: ${card.unassigned.join(", ")}`, ...echoing];
    return [`## ${source.id} (${source.type})`, ...domains, ...unassigned].join("\n");
  });
  return `Consolidate the index of the application in the environment ${environment}. The cards of its sources:\n\n${blocks.join("\n\n")}\n\nHand the index in with ${SUBMIT_TOOL}.`;
}
