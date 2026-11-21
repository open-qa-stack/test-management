import type { FoundMemory, Memory, MemoryContent, MemoryQuery } from "./memory.ts";

/** Most memories `closeMemories` gives. */
export const MAX_CLOSE_MEMORIES = 5;

/**
 * Ranks memories against a query.
 *
 * @remarks
 * A memory scores two points per tag in common and one per word of the query found in its text; on a tie, the one
 * written or corrected last comes first, then the one written last. Memories that score nothing are left out,
 * unless the query has neither tags nor text: it then gives the latest.
 *
 * @param memories - The memories, in the order they were written.
 * @param query - What to rank them against.
 * @returns The memories that match, the best first, `query.limit` at most.
 */
export function rankMemories(memories: readonly Memory[], query: MemoryQuery): FoundMemory[] {
  const tags = new Set((query.tags ?? []).map((tag) => tag.toLowerCase()));
  const words = wordsOf(query.text ?? "");
  const open = tags.size === 0 && words.size === 0;
  return memories
    .map((memory, position) => {
      const inText = wordsOf(memory.text);
      const score = 2 * memory.tags.filter((tag) => tags.has(tag)).length + [...words].filter((word) => inText.has(word)).length;
      return { memory: { ...memory, score }, position, changed: (memory.revised ?? memory.written).at };
    })
    .filter(({ memory }) => open || memory.score > 0)
    .sort((a, b) => b.memory.score - a.memory.score || compare(b.changed, a.changed) || b.position - a.position)
    .slice(0, query.limit)
    .map(({ memory }) => memory);
}

/**
 * The memories close to one about to be written: among those given, the best ranked against its text and its tags.
 *
 * @param memories - The memories of its domain and its kind, in the order they were written.
 * @param content - What the memory about to be written says.
 * @returns At most `MAX_CLOSE_MEMORIES`, the closest first; none when none shares a tag or a word with it.
 */
export function closeMemories(memories: readonly Memory[], content: Pick<MemoryContent, "text" | "tags">): FoundMemory[] {
  return rankMemories(memories, { text: content.text, tags: content.tags, limit: MAX_CLOSE_MEMORIES });
}

/** The words of a text worth matching: three letters or more, in lower case. */
function wordsOf(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}_]+/u)
      .filter((word) => word.length >= 3),
  );
}

/** Orders two ISO 8601 dates in UTC, which sort as their texts do. */
function compare(left: string, right: string): number {
  return Number(left > right) - Number(left < right);
}
