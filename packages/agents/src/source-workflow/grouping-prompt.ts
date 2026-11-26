import type { IndexSourceType } from "@open-qa-stack/domain";
import type { ExportedElement } from "@open-qa-stack/tools";
import { batchSummary } from "./element-batches.ts";
import type { Grouping } from "./grouping.ts";
import { sourceWords } from "./source-words.ts";
import { promptOf, type PromptTemplate, type PromptValues } from "../common/prompt-template.ts";

/** Name of the tool the model places the elements of a batch with. */
export const PLACE_TOOL = "place_elements";

/** Elements of a domain named as examples in the request of a batch. */
const EXAMPLES = 3;

/** The prompt of the grouping of the elements of one source, with what its elements are, what is set aside and the tool that places them. */
export const GROUPING_PROMPT = {
  template: `You group the elements of one source of an application — {{elements}} — into functional domains, one batch at a time, so that other agents find what they need by domain.

Rules:
- A domain is a functional area users would name: orders, policies, customers… Reuse a domain the request lists when an element belongs to it. Declare a new one in domains only when none fits, with an English slug as its id, a short label and one sentence of description.
- Give each element you place its role: one line on what it holds or does.
- Set an element aside, with a reason and no domain, only when it serves no functional area: {{set_aside}}.
- Use each name exactly as the request writes it. Place every element of the batch, none twice.
- Call {{place_tool}} once with every element of the batch. When it answers with problems, fix what it names and call it again with the elements still to place only. Then answer with one word.
- Keep with remember what the agents after you should know and no element says by itself, such as a rule several elements share or a name the team uses its own way. Not everything: a few facts that matter.`,
  variables: ["elements", "set_aside", "place_tool"],
} as const satisfies PromptTemplate;

/**
 * What each variable of the prompt of the grouping of the elements of a source stands for in a session.
 *
 * @param type - What the source is, which names its elements.
 * @returns The value of each variable.
 */
export function groupingValues(type: IndexSourceType): PromptValues<typeof GROUPING_PROMPT> {
  const words = sourceWords(type);
  return { elements: words.elements, set_aside: words.aside, place_tool: PLACE_TOOL };
}

/**
 * System instructions of the grouping of the elements of one source, batch by batch.
 *
 * @param type - What the source is, which names its elements.
 * @returns The instructions.
 */
export function groupingInstructions(type: IndexSourceType): string {
  return promptOf(GROUPING_PROMPT, groupingValues(type));
}

/**
 * Writes the request of one batch: where the grouping stands, and the elements to place now.
 *
 * @param sourceId - Identifier of the source.
 * @param position - Number of the batch, from 1.
 * @param total - Number of batches.
 * @param batch - The elements to place.
 * @param grouping - The grouping so far.
 * @param former - The domain an earlier run placed an element in, for those that changed since.
 * @returns The message that starts the session of the batch.
 */
export function batchRequest(
  sourceId: string,
  position: number,
  total: number,
  batch: readonly ExportedElement[],
  grouping: Grouping,
  former: ReadonlyMap<string, string>,
): string {
  const domains = grouping.domains().map((domain) => {
    const members = grouping.members(domain.id);
    const count = `${members.length} placed${grouping.isFull(domain.id) ? ", full: place nothing more in it" : ""}`;
    const examples = members.length === 0 ? "" : `; such as ${members.slice(0, EXAMPLES).join(", ")}`;
    return `- ${domain.id} — ${domain.label}: ${domain.description} (${count}${examples})`;
  });
  const elements = batch.map((element) => {
    const linked = element.links.flatMap((link) => {
      const state = grouping.state(link);
      return state !== undefined && "domain" in state ? [`${link} is in ${state.domain}`] : [];
    });
    const was = former.get(element.name);
    return [
      `### ${element.name}`,
      batchSummary(element),
      ...(linked.length === 0 ? [] : [`Linked: ${linked.join("; ")}.`]),
      ...(was === undefined ? [] : [`It changed since it was placed in ${was}.`]),
    ].join("\n");
  });
  return [
    `Batch ${position} of ${total} of the source ${sourceId}.`,
    domains.length === 0 ? "No domain exists yet: declare the ones this batch needs." : `Domains so far:\n${domains.join("\n")}`,
    `The ${batch.length} elements to place, each named by its ### line:`,
    ...elements,
    `Call ${PLACE_TOOL} with these ${batch.length} elements.`,
  ].join("\n\n");
}
