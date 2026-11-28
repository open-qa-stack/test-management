import { t } from "../i18n/i18n.ts";
import type { NavigationEntry } from "./navigation.ts";

/** What the screen of the other entries says of where each stands, as much as the instance told of it. */
export interface MoreFacts {
  /** How many domains the cartography named. */
  readonly domains?: number;
  /** How many campaigns are planned, their tests not run yet. */
  readonly plannedCampaigns?: number;
  /** How many defects are to deal with. */
  readonly openDefects?: number;
  readonly applications?: number;
  /** How many knowledge sources the configuration in force declares. */
  readonly sources?: number;
}

/**
 * Where each entry of the screen of the others stands, in a sentence: the entries the instance told nothing of, and
 * those that have nothing to count, say none.
 *
 * @param facts - What the instance told.
 * @returns The sentence of each entry it can say one of.
 */
export function summariesOf(facts: MoreFacts): Partial<Record<NavigationEntry["key"], string>> {
  const counted = [
    ["discovery", "domains", facts.domains],
    ["campaigns", "plannedCampaigns", facts.plannedCampaigns],
    ["defects", "openDefects", facts.openDefects],
    ["applications", "applications", facts.applications],
    ["knowledge", "sources", facts.sources],
  ] as const;
  return Object.fromEntries(
    counted.filter(([, , count]) => count !== undefined).map(([entry, words, count]) => [entry, t(`shell.summaries.${words}`, { count })]),
  );
}
