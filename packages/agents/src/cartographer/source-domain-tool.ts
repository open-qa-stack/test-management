import type { SourceCard, ToolDefinition } from "@open-qa-stack/domain";

/** Name of the tool that gives what the agent of a source wrote of one of its domains. */
export const READ_DOMAIN_TOOL = "read_source_domain";
/** Longest text of a domain the tool returns, in characters. */
export const MAX_DOMAIN_TEXT = 8000;

/**
 * The tool the orchestrator of the cartography reads the map of a source with, one domain at a time.
 *
 * @remarks
 * It gives the file the agent of the source wrote of the domain, when the source has one, cut at
 * `MAX_DOMAIN_TEXT` characters; otherwise the elements of the domain, each with what its card says of it.
 * It reads what the cartography of the sources left, and nothing of the sources themselves.
 *
 * @param cards - The card of each source that has one.
 * @param file - Reads the file of a domain of a source; `undefined` when the source has none.
 * @returns The tool.
 */
export function sourceDomainTool(
  cards: ReadonlyMap<string, SourceCard>,
  file: (source: string, domain: string) => Promise<string | undefined>,
): ToolDefinition {
  return {
    name: READ_DOMAIN_TOOL,
    description: "Returns what the agent that mapped a source wrote of one of its domains: what its elements are and what they hold.",
    parameters: {
      type: "object",
      properties: {
        source: { type: "string", description: "Identifier of the source, as listed." },
        domain: { type: "string", description: "Identifier of one of its domains, as listed." },
      },
      required: ["source", "domain"],
      additionalProperties: false,
    },
    execute: async (args) => {
      const { source, domain } = args as { source: string; domain: string };
      const card = cards.get(source);
      if (card === undefined) return { error: `${source} is no source that was mapped. The sources: ${[...cards.keys()].join(", ")}.` };
      const held = card.domains.find((candidate) => candidate.id === domain);
      if (held === undefined)
        return { error: `${source} has no domain ${domain}. Its domains: ${card.domains.map((candidate) => candidate.id).join(", ") || "none"}.` };
      const text = await file(source, domain);
      if (text === undefined)
        return [`# ${held.label} (\`${held.id}\`)`, "", held.description, "", ...held.items.map((item) => `- \`${item.name}\`: ${item.summary}`)].join("\n");
      return text.length <= MAX_DOMAIN_TEXT ? text : `${text.slice(0, MAX_DOMAIN_TEXT)}\n\n[Cut at ${MAX_DOMAIN_TEXT} of ${text.length} characters.]`;
    },
  };
}
