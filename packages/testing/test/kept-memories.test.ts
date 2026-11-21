import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { Memory } from "@open-qa-stack/domain";
import { KeptMemories } from "../src/index.ts";

const memory = (id: string, domain: string, source?: string): Memory => ({
  id,
  domain,
  kind: "pitfall",
  text: `What ${id} says.`,
  tags: [],
  ...(source === undefined ? {} : { source }),
  written: { role: "cartographer", task: "t", at: "2026-11-21T09:00:00.000Z" },
});

describe("the memories kept in memory", () => {
  it("lists those that equal every filter given, in the order they were written, and corrects one by the rule of the port", async () => {
    const memories = new KeptMemories([memory("m1", "orders", "shop-api")]);
    await memories.add(memory("m2", "customers"));
    assert.deepEqual(
      (await memories.list({})).map(({ id }) => id),
      ["m1", "m2"],
    );
    assert.deepEqual(
      (await memories.list({ domain: "orders", kind: "pitfall", source: "shop-api" })).map(({ id }) => id),
      ["m1"],
    );
    assert.deepEqual(await memories.list({ kind: "locator" }), []);
    const revised = { role: "planner", task: "u", at: "2026-11-21T10:00:00.000Z" };
    assert.equal(await memories.revise("m1", { text: "Now.", tags: ["x"] }, revised), true);
    assert.equal(await memories.revise("m2", { text: "Here.", tags: [], source: "shop-db" }, revised), true);
    assert.deepEqual(await memories.list({}), [
      { ...memory("m1", "orders"), text: "Now.", tags: ["x"], revised },
      { ...memory("m2", "customers", "shop-db"), text: "Here.", revised },
    ]);
    assert.equal(await memories.revise("m3", { text: "None.", tags: [] }, revised), false);
  });
});
