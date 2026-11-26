import type { SourceCard } from "@open-qa-stack/domain";
import { SUBMIT_TOOL } from "./domain-consolidation.ts";
import type { RunSource } from "./run-sources.ts";
import { READ_DOMAIN_TOOL } from "./source-domain-tool.ts";
import { promptOf, type PromptTemplate, type PromptValues } from "../common/prompt-template.ts";

/** Elements of a domain of a source named as examples in the request. */
const EXAMPLES = 3;

/** The prompt of the orchestrator of the cartography, with the tools it reads a domain of a source and hands the index in with. */
export const CARTOGRAPHER_PROMPT = {
  template: `You orchestrate the cartography of an application for a test platform. Each of its sources — contracts, databases, documents, source code, user interfaces — was mapped by its own agent, which grouped what the source holds into domains. You consolidate those into the functional domains of the application, so that the agents that plan tests know where to look.

How this works
- You do not place elements again: you say which domains of the sources are one functional area, and their elements follow.
- A domain of the application is a functional area users would name: orders, policies, customers, claims… It usually gathers a domain of several sources: the screens, the operations, the tables and the sections of one area. Give each an English slug as its id, a short label and one sentence of description.
- Two domains of sources that bear the same name are most often the same area. Two that bear different names may be the same too: read what they hold before you decide.
- A domain is never a kind of source, such as all the screens or all the tables, nor a part of the structure of a document, such as its scope or its open points.
- A domain of a source that covers two areas is cut: give it to both, with in items the elements each takes.
- What the agent of a source set aside stays aside: you are not asked about it.

Method
1. Read the domains of the sources below. {{read_domain_tool}} gives what the agent of a source wrote of one of its domains: call it when a name does not tell what the domain holds.
2. Recall what the agents before you kept, when it helps. When a map leaves a doubt, look in the source itself with its tools: its tables, its contract, its documents, its code, or the browser of the application, which changes no data here.
3. Call {{submit_tool}} with the domains of the application, each with the domains of the sources it gathers. Every domain of every source must be in one. If the index is refused, fix what the refusal says and call it again. Then answer with one sentence.

Keep with remember what the agents that plan tests should know about the application as a whole and no single source says, such as two sources that name the same thing differently. Not everything: a few facts that matter.`,
  variables: ["read_domain_tool", "submit_tool"],
} as const satisfies PromptTemplate;

/** What each variable of the prompt of the orchestrator of the cartography stands for. */
export const CARTOGRAPHER_VALUES: PromptValues<typeof CARTOGRAPHER_PROMPT> = { read_domain_tool: READ_DOMAIN_TOOL, submit_tool: SUBMIT_TOOL };

/** System instructions of the orchestrator of the cartography, which consolidates the domains of the sources. */
export const CARTOGRAPHER_INSTRUCTIONS = promptOf(CARTOGRAPHER_PROMPT, CARTOGRAPHER_VALUES);

/**
 * Writes the request that starts the consolidation: the domains each source was mapped into, not their
 * elements, which the orchestrator reads with a tool when it needs them.
 *
 * @param environment - Name of the environment.
 * @param sources - The sources of the run.
 * @param cards - The card of each source that has one.
 * @returns The message to send to the orchestrator.
 */
export function cartographyRequest(environment: string, sources: readonly RunSource[], cards: ReadonlyMap<string, SourceCard>): string {
  const blocks = sources.map((source) => {
    const card = cards.get(source.id);
    if (card === undefined) return `## ${source.id} (${source.type}): not mapped; leave it out.`;
    const domains = card.domains.map((domain) => {
      const names = domain.items.slice(0, EXAMPLES).map((item) => item.name);
      const count = `${domain.items.length} ${domain.items.length === 1 ? "element" : "elements"}`;
      return `- ${domain.id} — ${domain.label}: ${domain.description} (${count}, such as ${names.join(", ")})`;
    });
    const aside = card.unassigned.length === 0 ? [] : [`- Set aside by its agent: ${card.unassigned.length} elements.`];
    return [`## ${source.id} (${source.type})`, ...(domains.length === 0 ? ["- No domain."] : domains), ...aside].join("\n");
  });
  return `Consolidate the domains of the application in the environment ${environment}. The domains each source was mapped into:\n\n${blocks.join("\n\n")}\n\nNext: read with ${READ_DOMAIN_TOOL} what a name does not tell, then call ${SUBMIT_TOOL}.`;
}
