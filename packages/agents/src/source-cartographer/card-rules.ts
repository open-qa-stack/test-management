import { validateSourceCardSubmission, type IndexError, type SourceCardSubmission } from "@open-qa-stack/shared";
import type { SourceInventory } from "@open-qa-stack/tools";
import type { SubmissionRules } from "../common/handed-in.ts";

/** Name of the tool the cartographer of a source hands its card in with. */
export const SUBMIT_CARD_TOOL = "submit_card";

const ITEM = {
  type: "object",
  properties: {
    name: { type: "string", description: "The element, exactly as listed." },
    summary: { type: "string", description: "One sentence on what it holds or does." },
    keyFields: { type: "array", items: { type: "string" }, description: "Its important fields, a few at most." },
  },
} as const;

/** The shape of a card submission, given to the model; its rules are left to the harness. */
const CARD_SHAPE = {
  type: "object",
  properties: {
    domains: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "An English slug: lower case letters and digits, separated by hyphens." },
          label: { type: "string" },
          description: { type: "string", description: "One sentence." },
          items: { type: "array", items: ITEM },
        },
      },
    },
    unassigned: { type: "array", items: { type: "string" }, description: "Elements you put in no domain." },
  },
} as const;

/**
 * How the cartographer of one source hands its card in.
 *
 * @remarks
 * A submission is checked against its schema, then it must place every element of the inventory and invent
 * none. An element written after the name of the source and a slash or a colon is read without it.
 *
 * @param sourceId - Identifier of the source.
 * @param inventory - What the harness knows of it when a card is handed in.
 * @returns The rules.
 */
export function cardRules(sourceId: string, inventory: () => SourceInventory): SubmissionRules<SourceCardSubmission> {
  const bare = (name: string) => (name.startsWith(`${sourceId}/`) || name.startsWith(`${sourceId}:`) ? name.slice(sourceId.length + 1) : name);
  return {
    tool: SUBMIT_CARD_TOOL,
    what: "card",
    description: `Hands in the card of the source ${sourceId}: its elements grouped by functional domain, each with a one-sentence summary and its important fields, and in unassigned the elements you put in no domain. Every element of the source must appear once at least.`,
    shape: CARD_SHAPE,
    validate: validateSourceCardSubmission,
    check: (valid) => {
      const { items } = inventory();
      const known = new Set(items);
      const value: SourceCardSubmission = {
        domains: valid.domains.map((domain) => ({ ...domain, items: domain.items.map((item) => ({ ...item, name: bare(item.name) })) })),
        unassigned: valid.unassigned.map(bare),
      };
      const named = [
        ...value.domains.flatMap((domain, i) => domain.items.map((item, k) => [`/domains/${i}/items/${k}/name`, item.name] as const)),
        ...value.unassigned.map((name, k) => [`/unassigned/${k}`, name] as const),
      ];
      const errors: IndexError[] = named
        .filter(([, name]) => !known.has(name))
        .map(([path, name]) => ({ path, message: `${path}: ${name} is not an element of ${sourceId}; use one of the elements listed.` }));
      const placed = new Set(named.map(([, name]) => name));
      const missing = items.filter((item) => !placed.has(item));
      for (const item of missing) errors.push({ path: "", message: `${item} is in no domain nor in unassigned.` });
      return { value, errors, unplaced: missing.length === 0 ? new Map() : new Map([[sourceId, missing]]) };
    },
  };
}
