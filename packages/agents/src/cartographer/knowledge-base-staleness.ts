import type { KnowledgeBase, SourceCard } from "@open-qa-stack/domain";
import { cardFingerprint } from "./card-fingerprint.ts";
import type { RunSource } from "./run-sources.ts";

/**
 * Why the knowledge base at hand cannot be kept for a run, if it can be kept.
 *
 * @remarks
 * A knowledge base is kept when it is complete, of the environment of the run, of exactly its sources, and made of
 * exactly its cards: the fingerprint it records for each source is that of the card the source has now.
 *
 * @param knowledgeBase - The knowledge base at hand, if one could be read.
 * @param environment - Name of the environment of the run.
 * @param sources - The sources of the run.
 * @param cards - The card of each source that has one now.
 * @returns The first reason found, as the end of a sentence; none when the knowledge base is up to date.
 */
export function knowledgeBaseStaleness(
  knowledgeBase: KnowledgeBase | undefined,
  environment: string,
  sources: readonly RunSource[],
  cards: ReadonlyMap<string, SourceCard>,
): string | undefined {
  if (knowledgeBase === undefined) return "no knowledge base could be read";
  if (knowledgeBase.environment !== environment) return `the knowledge base at hand is of the environment ${knowledgeBase.environment}`;
  if (knowledgeBase.status !== "complete") return "the knowledge base at hand is truncated";
  const recorded = new Map(knowledgeBase.sources.map((source) => [source.id, source.cardFingerprint] as const));
  const added = sources.find((source) => !recorded.has(source.id));
  if (added !== undefined) return `${added.id} is not a source of the knowledge base at hand`;
  const removed = knowledgeBase.sources.find((source) => !sources.some((candidate) => candidate.id === source.id));
  if (removed !== undefined) return `${removed.id} is no longer a source of the run`;
  const changed = sources.find((source) => {
    const card = cards.get(source.id);
    return card === undefined || recorded.get(source.id) !== cardFingerprint(card);
  });
  if (changed === undefined) return undefined;
  // An earlier version wrote no fingerprint: nothing tells which cards the knowledge base was made of.
  return recorded.get(changed.id) === undefined
    ? `the knowledge base at hand records no fingerprint of the card of ${changed.id}, as an earlier version made it`
    : `the card of ${changed.id} is not the one the knowledge base at hand was made of`;
}
