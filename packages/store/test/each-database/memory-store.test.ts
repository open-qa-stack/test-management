import assert from "node:assert/strict";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { MemoryStore } from "../../src/memory/memory-store.ts";
import { at } from "../support/at.ts";
import { engineUnderTest } from "../support/database-engine.ts";
import { SessionDatabase } from "../support/session-database.ts";
import type { Memory, MemoryKind } from "@open-qa-stack/domain";

const engine = engineUnderTest();

let database: SessionDatabase;
let store: MemoryStore;
beforeAll(async () => {
  database = await SessionDatabase.create(engine);
  store = new MemoryStore(database.database);
});
beforeEach(() => database.clear());
afterAll(() => database.drop());

const written = (id: string, domain: string, kind: MemoryKind, seconds: number, source?: string): Memory => ({
  id,
  domain,
  kind,
  text: `What ${id} says.`,
  tags: ["checkout", "total"],
  ...(source === undefined ? {} : { source }),
  written: { role: "cartographer", task: `card-${id}`, at: at(seconds) },
});

describe("the memories the store keeps", () => {
  it("gives back a memory as it was written", async () => {
    const memory = written("m1", "orders", "pitfall", 1, "shop-api");
    await store.add(memory);
    assert.deepEqual(await store.list({}), [memory]);
  });

  it("lists exactly the memories of a domain, of a kind, of a source, or of them together, in the order they were written", async () => {
    const memories = [
      written("m3", "orders", "pitfall", 3),
      written("m1", "orders", "pitfall", 1, "shop-api"),
      written("m2", "orders", "business_rule", 2),
      written("m4", "orders-archive", "pitfall", 4),
      written("m5", "customers", "pitfall", 5, "shop-api"),
    ];
    for (const memory of memories) await store.add(memory);
    const ids = async (filter: Parameters<MemoryStore["list"]>[0]) => (await store.list(filter)).map(({ id }) => id);
    assert.deepEqual(await ids({}), ["m1", "m2", "m3", "m4", "m5"]);
    assert.deepEqual(await ids({ domain: "orders" }), ["m1", "m2", "m3"]);
    assert.deepEqual(await ids({ kind: "pitfall" }), ["m1", "m3", "m4", "m5"]);
    assert.deepEqual(await ids({ domain: "orders", kind: "pitfall" }), ["m1", "m3"]);
    assert.deepEqual(await ids({ source: "shop-api" }), ["m1", "m5"]);
    assert.deepEqual(await ids({ domain: "orders", kind: "pitfall", source: "shop-api" }), ["m1"]);
    assert.deepEqual(await ids({ domain: "Orders" }), []);
  });

  it("lists two memories written in the same millisecond in the order of their identifiers", async () => {
    await store.add(written("b", "orders", "pitfall", 1));
    await store.add(written("a", "orders", "pitfall", 1));
    assert.deepEqual(
      (await store.list({})).map(({ id }) => id),
      ["a", "b"],
    );
  });

  it("corrects what a memory says and keeps its identifier, its domain, its kind and who wrote it, and tells when it keeps none of that identifier", async () => {
    const memory = written("m1", "orders", "pitfall", 1, "shop-api");
    await store.add(memory);
    const revised = { role: "planner", task: "plan-1", at: at(9) };
    assert.equal(await store.revise("m1", { text: "What m1 says now.", tags: [] }, revised), true);
    const { source: _, ...unsourced } = memory;
    assert.deepEqual(await store.list({}), [{ ...unsourced, text: "What m1 says now.", tags: [], revised }]);
    assert.equal(await store.revise("m1", { text: "Again.", tags: ["x"], source: "shop-db" }, revised), true);
    assert.equal((await store.list({ source: "shop-db" }))[0]?.text, "Again.");
    assert.equal(await store.revise("unknown", { text: "Nothing.", tags: [] }, revised), false);
    assert.equal((await store.list({})).length, 1);
  });
});
