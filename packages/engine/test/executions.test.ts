import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { Executions } from "../src/index.ts";
import { MemoryExecutionStore } from "./support/memory-execution-store.ts";

describe("the operations on the executions of tests", () => {
  it("read the executions the store keeps, the latest first", async () => {
    const store = new MemoryExecutionStore();
    const first = { id: "e1", origin: "design", ranAt: "2026-11-19T09:00:00.000Z", report: "r1.json", results: [] } as const;
    const second = { ...first, id: "e2", ranAt: "2026-11-19T10:00:00.000Z" };
    await store.add(first);
    await store.add(second);
    assert.deepEqual(await new Executions(store).list(), [second, first]);
  });
});
