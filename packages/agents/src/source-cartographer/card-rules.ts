import { validateSourceCardSubmission, type IndexError, type SourceCardSubmission } from "@open-qa-stack/domain";
import type { SourceInventory } from "@open-qa-stack/tools";
import { secretErrors } from "../common/config-secrets.ts";
import { withUnassigned } from "../common/with-unassigned.ts";
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
 * A submission without `unassigned` puts no element there. It is checked against its schema, then it must place every element of the inventory, invent
 * none and hold no secret. A name that is no element but becomes one without the name of the source and a
 * slash or a colon in front is read without them.
 *
 * @param sourceId - Identifier of the source.
 * @param inventory - What the harness knows of it when a card is handed in.
 * @param secrets - The secrets of the configuration, which no card may hold.
 * @returns The rules.
 */
export function cardRules(sourceId: string, inventory: () => SourceInventory, secrets: readonly string[]): SubmissionRules<SourceCardSubmission> {
  return {
    tool: SUBMIT_CARD_TOOL,
    what: "card",
    source: sourceId,
    secrets,
    description: `Hands in the card of the source ${sourceId}: its elements grouped by functional domain, each with a one-sentence summary and its important fields, and in unassigned the elements you put in no domain. Every element of the source must appear once at least.`,
    shape: CARD_SHAPE,
    validate: (args) => validateSourceCardSubmission(withUnassigned(args)),
    check: (valid) => {
      const { items } = inventory();
      const known = new Set(items);
      const bare = (name: string) =>
        !known.has(name) && (name.startsWith(`${sourceId}/`) || name.startsWith(`${sourceId}:`)) ? name.slice(sourceId.length + 1) : name;
      const value: SourceCardSubmission = {
        domains: valid.domains.map((domain) => ({ ...domain, items: domain.items.map((item) => ({ ...item, name: bare(item.name) })) })),
        unassigned: valid.unassigned.map(bare),
      };
      const named = [
        ...value.domains.flatMap((domain, i) => domain.items.map((item, k) => [`/domains/${i}/items/${k}/name`, item.name] as const)),
        ...value.unassigned.map((name, k) => [`/unassigned/${k}`, name] as const),
      ];
      const invented = named
        .filter(([, name]) => !known.has(name))
        .map(([path, name]) => ({ path, message: `${path}: ${name} is not an element of ${sourceId}; use one of the elements listed.` }));
      const errors: IndexError[] = [...secretErrors(value, secrets), ...invented];
      const placed = new Set(named.map(([, name]) => name));
      const missing = items.filter((item) => !placed.has(item));
      for (const item of missing) errors.push({ path: "", message: `${item} is in no domain nor in unassigned.` });
      return { value, errors, unplaced: missing.length === 0 ? new Map() : new Map([[sourceId, missing]]) };
    },
    leaveAside: (value, unplaced) => ({ ...value, unassigned: [...value.unassigned, ...[...unplaced.values()].flat()] }),
  };
}
