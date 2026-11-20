import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { UnknownExecutionError, type Execution } from "@open-qa-stack/domain";
import { Executions, FILE_EXECUTIONS_LIMIT } from "../src/index.ts";
import { MemoryExecutionStore } from "./support/memory-execution-store.ts";

/** An execution of a session of design, at an hour of the morning, with the results given. */
const execution = (id: string, hour: number, results: Execution["results"] = []): Execution => ({
  id,
  origin: "design",
  ranAt: `2026-11-19T${String(hour).padStart(2, "0")}:00:00.000Z`,
  report: `${id}.json`,
  results,
});

/** A result of the test of the orders. */
const search = { path: "apps/shop/tests/orders/search.spec.ts", title: "Search an order", project: "shop", verdict: "passed", durationMs: 120 } as const;

describe("the operations on the executions of tests", () => {
  it("read the executions the store keeps a page at a time, the latest first", async () => {
    const store = new MemoryExecutionStore();
    for (const [id, hour] of [
      ["e1", 9],
      ["e2", 10],
      ["e3", 11],
    ] as const)
      await store.add(execution(id, hour));
    const executions = new Executions(store);
    assert.deepEqual(await executions.page({ limit: 2 }), { items: [execution("e3", 11), execution("e2", 10)], next: "e2" });
    assert.deepEqual(await executions.page({ limit: 2, before: "e2" }), { items: [execution("e1", 9)] });
  });

  it("read an execution by its identifier, and refuse one the store does not keep", async () => {
    const store = new MemoryExecutionStore();
    await store.add(execution("e1", 9, [search]));
    const executions = new Executions(store);
    assert.deepEqual(await executions.get("e1"), execution("e1", 9, [search]));
    await assert.rejects(executions.get("e2"), new UnknownExecutionError("e2"));
  });

  it("read what came of the tests of a file in its latest executions, as many as the limit says", async () => {
    const store = new MemoryExecutionStore();
    // One more execution than the limit, each kept after the one before it.
    for (let kept = 0; kept <= FILE_EXECUTIONS_LIMIT; kept += 1) await store.add(execution(`e${kept}`, 0, [search]));
    const read = await new Executions(store).ofFile(search.path);
    assert.deepEqual([read.length, read[0]?.id, read[0]?.result], [FILE_EXECUTIONS_LIMIT, `e${FILE_EXECUTIONS_LIMIT}`, search]);
  });
});
