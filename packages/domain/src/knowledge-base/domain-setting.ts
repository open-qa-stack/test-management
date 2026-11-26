import type { KnowledgeBase } from "./types.ts";

/** What a person set of a domain of the knowledge, kept apart from the knowledge base the cartography writes: it stays when the knowledge base is written again, for a domain of the same identifier. */
export interface DomainSetting {
  /** The identifier of the domain. */
  readonly id: string;
  /** The name that replaces the one the cartography gave it; left out for a domain that keeps it. */
  readonly label?: string;
  /** Whether the domain is kept from the sessions and from the agents. */
  readonly excluded: boolean;
}

/** What a person changes of a domain: its name, whether it is excluded, or both. */
export interface DomainChange {
  readonly label?: string;
  readonly excluded?: boolean;
}

/**
 * The knowledge base as a person set it: without the domains they excluded, and with the names they gave.
 *
 * @param knowledgeBase - The knowledge base, as the cartography wrote it.
 * @param settings - What the person set; that of a domain the knowledge base does not hold changes nothing.
 * @returns The knowledge base the agents are served.
 */
export function settledKnowledgeBase(knowledgeBase: KnowledgeBase, settings: readonly DomainSetting[]): KnowledgeBase {
  const set = new Map(settings.map((setting) => [setting.id, setting]));
  return {
    ...knowledgeBase,
    domains: knowledgeBase.domains
      .filter(({ id }) => set.get(id)?.excluded !== true)
      .map((domain) => ({ ...domain, label: set.get(domain.id)?.label ?? domain.label })),
  };
}
