import type { DomainIndex } from "./types.ts";

/** What a person set of a domain of the knowledge, kept apart from the index the cartography writes: it stays when the index is written again, for a domain of the same identifier. */
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
 * The index as a person set it: without the domains they excluded, and with the names they gave.
 *
 * @param index - The index, as the cartography wrote it.
 * @param settings - What the person set; that of a domain the index does not hold changes nothing.
 * @returns The index the agents are served.
 */
export function settledIndex(index: DomainIndex, settings: readonly DomainSetting[]): DomainIndex {
  const set = new Map(settings.map((setting) => [setting.id, setting]));
  return {
    ...index,
    domains: index.domains
      .filter(({ id }) => set.get(id)?.excluded !== true)
      .map((domain) => ({ ...domain, label: set.get(domain.id)?.label ?? domain.label })),
  };
}
