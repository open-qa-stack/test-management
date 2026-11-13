import type { SourceInventory } from "@open-qa-stack/shared";
import { SUBMIT_TOOL } from "./domain-index-rules.ts";
import type { RunSource } from "./run-sources.ts";

/** System instructions of the cartographer. */
export const CARTOGRAPHER_INSTRUCTIONS = `You are the cartographer of a test platform. You explore an application through the sources its team declared, and you write an index of its functional domains, so that the test designers know where to look.

Rules:
- Use only the tools you are given; never guess an address, a table, a tag or a screen that a tool did not show you.
- A domain is a functional area that users would name: orders, policies, customers, claims… Give each an English slug as its id, a short label and one sentence of description.
- References stay coarse: tags or path prefixes of a contract, tables of a base, URL paths of a user interface, section titles of a document, folders or files of source code. Never list operations one by one, columns, or links between a screen, an operation and a table.
- Every domain has an id, a label, a description and references; each reference names one source by its id, exactly as listed below, and gives its items.
- Every tag and table listed below for a contract or a base must be placed, in a domain or in unassigned, using the items exactly as listed, without the name of the source in front.
- Explore the user interfaces by reading pages and following links; sign in with the declared test accounts when a screen requires it. Never submit any other form.
- Keep with remember the facts worth knowing for the agents that will write tests, and recall what earlier agents kept.
- When you know the domains, call ${SUBMIT_TOOL}. If it refuses the index, fix what it says and call it again. Then answer with one sentence.`;

/**
 * Writes the request that starts a cartography: the sources, and the items each domain must place.
 *
 * @param environment - Name of the environment explored.
 * @param sources - The sources of the run.
 * @param inventory - The items of each contract and base, read by the harness.
 * @returns The message to send to the cartographer.
 */
export function cartographyRequest(environment: string, sources: readonly RunSource[], inventory: SourceInventory): string {
  const lines = sources.map((source) => {
    const items = inventory.get(source.id);
    const where = source.type === "web" ? ` at ${source.uiUrl}` : "";
    return `- ${source.id} (${source.type})${where}${items === undefined ? "" : `, items to place: ${JSON.stringify(items)}`}`;
  });
  return `Map the application in the environment ${environment}. Its sources:\n${lines.join("\n")}\n\nExplore what you need, then hand in the index with ${SUBMIT_TOOL}.`;
}
