import type { DomainIndex, SourceCard } from "@open-qa-stack/shared";
import { cardFingerprint } from "./card-fingerprint.ts";
import type { RunSource } from "./run-sources.ts";

/**
 * Why the index at hand cannot be kept for a run, if it can be kept.
 *
 * @remarks
 * An index is kept when it is complete, of the environment of the run, of exactly its sources, and made of
 * exactly its cards: the fingerprint it records for each source is that of the card the source has now.
 *
 * @param index - The index at hand, if one could be read.
 * @param environment - Name of the environment of the run.
 * @param sources - The sources of the run.
 * @param cards - The card of each source that has one now.
 * @returns The first reason found, as the end of a sentence; none when the index is up to date.
 */
export function indexStaleness(
  index: DomainIndex | undefined,
  environment: string,
  sources: readonly RunSource[],
  cards: ReadonlyMap<string, SourceCard>,
): string | undefined {
  if (index === undefined) return "no index could be read";
  if (index.environment !== environment) return `the index at hand is of the environment ${index.environment}`;
  if (index.status !== "complete") return "the index at hand is truncated";
  const recorded = new Map(index.sources.map((source) => [source.id, source.cardFingerprint] as const));
  const added = sources.find((source) => !recorded.has(source.id));
  if (added !== undefined) return `${added.id} is not a source of the index at hand`;
  const removed = index.sources.find((source) => !sources.some((candidate) => candidate.id === source.id));
  if (removed !== undefined) return `${removed.id} is no longer a source of the run`;
  const changed = sources.find((source) => {
    const card = cards.get(source.id);
    return card === undefined || recorded.get(source.id) !== cardFingerprint(card);
  });
  return changed === undefined ? undefined : `the card of ${changed.id} is not the one the index at hand was made of`;
}
