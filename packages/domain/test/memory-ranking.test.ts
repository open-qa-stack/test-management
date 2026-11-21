import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { closeMemories, MAX_CLOSE_MEMORIES, MEMORY_KINDS, rankMemories, type Memory } from "../src/index.ts";

const at = (minute: number) => `2026-11-21T10:${String(minute).padStart(2, "0")}:00.000Z`;

const memory = (id: string, text: string, tags: readonly string[] = [], minute = 0, revisedAt?: number): Memory => ({
  id,
  domain: "orders",
  kind: "pitfall",
  text,
  tags,
  written: { role: "cartographer", task: "t", at: at(minute) },
  ...(revisedAt === undefined ? {} : { revised: { role: "planner", task: "u", at: at(revisedAt) } }),
});

const ids = (found: readonly Memory[]) => found.map(({ id }) => id);

describe("the kinds of memories", () => {
  it("are a closed list of six English keys", () => {
    assert.deepEqual(MEMORY_KINDS, ["business_rule", "pitfall", "test_data", "locator", "navigation", "vocabulary"]);
  });
});

describe("the lexical ranking of memories", () => {
  const memories = [
    memory("a", "The order form clears its total when the currency changes.", ["checkout"], 1),
    memory("b", "A refund takes a minute to show.", ["refund", "checkout"], 2),
    memory("c", "The total of an order is rounded to the cent.", [], 3),
  ];

  it("gives two points per tag in common and one per word of the query, the best first, case ignored", () => {
    const found = rankMemories(memories, { tags: ["Checkout", "refund"], text: "TOTAL order", limit: 10 });
    assert.deepEqual(
      found.map(({ id, score }) => [id, score]),
      [
        ["b", 4],
        ["a", 4],
        ["c", 2],
      ],
    );
  });

  it("leaves out the memories that score nothing, and keeps to the limit", () => {
    assert.deepEqual(ids(rankMemories(memories, { text: "refund", limit: 10 })), ["b"]);
    assert.deepEqual(ids(rankMemories(memories, { text: "order total", limit: 1 })), ["c"]);
  });

  it("gives the latest, written or corrected, without tags nor text", () => {
    assert.deepEqual(ids(rankMemories(memories, { limit: 10 })), ["c", "b", "a"]);
    assert.deepEqual(ids(rankMemories([...memories.slice(0, 2), memory("a2", "x", [], 0, 9)], { tags: [], text: "", limit: 2 })), ["a2", "b"]);
  });

  it("puts the one written last first between two of the same score and the same date", () => {
    assert.deepEqual(ids(rankMemories([memory("first", "same words"), memory("second", "same words")], { text: "words", limit: 10 })), ["second", "first"]);
  });
});

describe("the memories close to one about to be written", () => {
  it("are those that share a tag or a word with it, the closest first, five at most", () => {
    const many = Array.from({ length: 7 }, (_, i) => memory(`m${i}`, `The total ${i === 0 ? "of the cart total" : "shown"}.`, [], i));
    const close = closeMemories([...many, memory("far", "Nothing alike here.")], { text: "The cart total", tags: [] });
    assert.equal(close.length, MAX_CLOSE_MEMORIES);
    assert.equal(close[0]?.id, "m0");
    assert.ok(!ids(close).includes("far"));
  });

  it("are none when none shares a tag or a word with it", () => {
    assert.deepEqual(closeMemories([memory("a", "Refunds are slow.", ["refund"])], { text: "Avatars upload.", tags: ["profile"] }), []);
  });
});
