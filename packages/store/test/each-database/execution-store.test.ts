import assert from "node:assert/strict";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { ExecutionStore } from "../../src/executions/execution-store.ts";
import { at } from "../support/at.ts";
import { engineUnderTest } from "../support/database-engine.ts";
import { SessionDatabase } from "../support/session-database.ts";
import { UnknownExecutionError, type Execution, type ExecutionResult } from "@open-qa-stack/domain";

const engine = engineUnderTest();

let database: SessionDatabase;
let store: ExecutionStore;
beforeAll(async () => {
  database = await SessionDatabase.create(engine);
  store = new ExecutionStore(database.database);
});
beforeEach(() => database.clear());
afterAll(() => database.drop());

/** A result of a test of the orders. */
const result = (title: string, extra: Partial<ExecutionResult> = {}): ExecutionResult => ({
  path: "apps/shop/tests/orders/search.spec.ts",
  title,
  project: "shop",
  verdict: "passed",
  durationMs: 120,
  ...extra,
});

/** An execution of a session of design, kept at a number of seconds after the start of the tests. */
const execution = (id: string, seconds: number, extra: Partial<Execution> = {}): Execution => ({
  id,
  origin: "design",
  ranAt: at(seconds),
  report: `.oqas/runs/run-${id}/report.json`,
  results: [],
  ...extra,
});

describe("the executions of tests the store keeps", () => {
  it("are none until one is kept", async () => {
    assert.deepEqual(
      [await store.page({ limit: 25 }), await store.get("e1"), await store.ofFile("apps/shop/tests/orders/search.spec.ts", 10), await store.reports()],
      [{ items: [] }, undefined, [], []],
    );
  });

  it("are listed the latest first, each with its results in the order of its report, and nothing it did not say", async () => {
    await database.database.kysely
      .insertInto("sessions")
      .values({ id: "s1", opened_at: at(0), last_event_at: at(0), state: "completed" })
      .execute();
    const first = execution("e1", 10, {
      sessionId: "s1",
      commit: "4f2a9c0",
      results: [
        result("Search an order", { fileDigest: "ab12" }),
        result("Orders › Filter by date", { verdict: "failed", durationMs: 300 }),
        result("Orders › Filter by shop", { verdict: "skipped", durationMs: 0 }),
      ],
    });
    const second = execution("e2", 20, { results: [result("Search an order", { verdict: "flaky" })] });
    await store.add(first);
    await store.add(second);
    await store.add(execution("e0", 20));
    assert.deepEqual(await store.page({ limit: 25 }), { items: [second, execution("e0", 20), first] });
    assert.deepEqual(await store.get("e1"), first);
    assert.deepEqual(
      (await store.reports()).toSorted((left, right) => left.localeCompare(right)),
      [execution("e0", 20).report, first.report, second.report],
    );
  });

  it("are read a page at a time, each page going on after the last execution of the one before it, dates tied by identifier", async () => {
    for (const [id, seconds] of [
      ["e1", 10],
      ["e2", 20],
      ["e3", 20],
      ["e4", 30],
    ] as const)
      await store.add(execution(id, seconds));
    const first = await store.page({ limit: 2 });
    assert.deepEqual(first, { items: [execution("e4", 30), execution("e3", 20)], next: "e3" });
    assert.deepEqual(await store.page({ limit: 2, before: "e3" }), { items: [execution("e2", 20), execution("e1", 10)] });
    await assert.rejects(store.page({ limit: 2, before: "gone" }), UnknownExecutionError);
  });

  it("are read by what came of their tests: failing when one of them failed, passing when none did", async () => {
    const failing = execution("e1", 10, { results: [result("Search an order"), result("Filter", { verdict: "failed" })] });
    const passing = execution("e2", 20, { results: [result("Search an order", { verdict: "flaky" })] });
    await store.add(failing);
    await store.add(passing);
    assert.deepEqual(
      [await store.page({ limit: 25, outcome: "failing" }), await store.page({ limit: 25, outcome: "passing" })],
      [{ items: [failing] }, { items: [passing] }],
    );
  });

  it("tell what came of the tests of a file in each execution, the latest first, with the execution but not its other tests", async () => {
    const other = result("Pay", { path: "apps/shop/tests/orders/pay.spec.ts" });
    await store.add(execution("e1", 10, { commit: "4f2a9c0", results: [result("Search an order"), other, result("Filter", { verdict: "failed" })] }));
    await store.add(execution("e2", 20, { results: [result("Search an order", { verdict: "flaky" })] }));
    assert.deepEqual(await store.ofFile("apps/shop/tests/orders/search.spec.ts", 2), [
      { id: "e2", origin: "design", ranAt: at(20), result: result("Search an order", { verdict: "flaky" }) },
      { id: "e1", origin: "design", ranAt: at(10), commit: "4f2a9c0", result: result("Search an order") },
    ]);
  });

  it("keep an execution whole or not at all: one under an identifier already kept adds nothing", async () => {
    await store.add(execution("e1", 10, { results: [result("Search an order")] }));
    await assert.rejects(store.add(execution("e1", 20, { results: [result("Another")] })));
    assert.deepEqual(await store.page({ limit: 25 }), { items: [execution("e1", 10, { results: [result("Search an order")] })] });
  });

  it("keep the executions of a session once the session goes, without it", async () => {
    const { kysely } = database.database;
    await kysely
      .insertInto("sessions")
      .values({ id: "s1", opened_at: at(0), last_event_at: at(0), state: "completed" })
      .execute();
    await store.add(execution("e1", 10, { sessionId: "s1", results: [result("Search an order")] }));
    await kysely.deleteFrom("sessions").execute();
    assert.deepEqual(await store.get("e1"), execution("e1", 10, { results: [result("Search an order")] }));
  });
});
