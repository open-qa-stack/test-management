import type { SourceInventory } from "@open-qa-stack/tools";
import { SUBMIT_CARD_TOOL } from "./card-rules.ts";
import { promptOf, type PromptTemplate, type PromptValues } from "../common/prompt-template.ts";

/** The prompt of the cartographer of one source, with the tool it hands its card in with. */
export const SOURCE_CARTOGRAPHER_PROMPT = {
  template: `You are the cartographer of one source of an application: a contract, a database, a document, source code or a user interface. You write its card: its elements grouped by functional domain, so that other agents find their way in it without reading it all.

Rules:
- Use only the tools you are given; never guess an element, a field or a fact that a tool did not show you.
- A domain is a functional area users would name: orders, policies, customers… Give each an English slug as its id, a short label and one sentence of description.
- Place every element the request lists — for a user interface, every screen you visited — in a domain or in unassigned, using its name exactly as given.
- For each element placed in a domain, write one sentence on what it holds or does, and list its important fields: the columns, parameters or fields of a screen a test would read or fill, a few at most. Keys and links between elements are already known; do not repeat them.
- Keep with remember the facts worth knowing for the agents that will write tests — a rule the data shows, an element that matters more than its name says — and recall what earlier agents kept.
- When the card is ready, call {{submit_tool}}. If it refuses the card, fix what it says and call it again. Then answer with one sentence.`,
  variables: ["submit_tool"],
} as const satisfies PromptTemplate;

/** What each variable of the prompt of the cartographer of a source stands for. */
export const SOURCE_CARTOGRAPHER_VALUES: PromptValues<typeof SOURCE_CARTOGRAPHER_PROMPT> = { submit_tool: SUBMIT_CARD_TOOL };

/** System instructions of the cartographer of one source. */
export const SOURCE_CARTOGRAPHER_INSTRUCTIONS = promptOf(SOURCE_CARTOGRAPHER_PROMPT, SOURCE_CARTOGRAPHER_VALUES);

/**
 * Writes the request that starts the cartography of one source: its elements and what is known of them, so
 * that the agent calls a tool only for what the request does not show.
 *
 * @param sourceId - Identifier of the source.
 * @param type - Its kind.
 * @param inventory - What the harness read of it.
 * @returns The message to send to the cartographer.
 */
export function sourceCardRequest(sourceId: string, type: string, inventory: SourceInventory): string {
  const lines = inventory.items.map((item) => `- ${item}${describe(inventory.facts.get(item))}`);
  const names = JSON.stringify(inventory.items);
  return `Write the card of the source ${sourceId} (${type}). Its ${inventory.items.length} elements, with what is already known of each:\n${lines.join("\n")}\n\nThe elements to place are exactly these names: ${names}. What follows each name in parentheses is known facts, not elements. Call a tool only for what this request does not show, then hand the card in with ${SUBMIT_CARD_TOOL}.`;
}

/** The facts of an element, in a few words: its keys and links, or its operations. */
function describe(facts: Readonly<Record<string, unknown>> = {}): string {
  const parts = Object.entries(facts).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return parts.length === 0 ? "" : ` (${parts.join("; ")})`;
}
