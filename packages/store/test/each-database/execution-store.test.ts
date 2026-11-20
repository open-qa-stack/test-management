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
    const path = "apps/shop/tests/orders/search.spec.ts";
    assert.deepEqual(
      [await store.page({ limit: 25 }), await store.get("e1"), await store.ofFile(path, 10), await store.versions(path), await store.reports()],
      [{ items: [], total: 0, start: 0 }, undefined, [], [], []],
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
        result("Orders › Filter by date", {
          verdict: "failed",
          durationMs: 300,
          failure: {
            step: { number: 2, title: "Filter by date" },
            message: "Error: expect(locator).toHaveText(expected) failed",
            expected: "3 orders",
            received: "0 orders",
          },
        }),
        result("Orders › Filter by year", { verdict: "failed", failure: { message: "Test timeout of 30000ms exceeded." } }),
        result("Orders › Filter by shop", { verdict: "skipped", durationMs: 0 }),
      ],
    });
    const second = execution("e2", 20, { results: [result("Search an order", { verdict: "flaky" })] });
    await store.add(first);
    await store.add(second);
    await store.add(execution("e0", 20));
    assert.deepEqual(await store.page({ limit: 25 }), { items: [second, execution("e0", 20), first], total: 3, start: 0 });
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
    assert.deepEqual(first, { items: [execution("e4", 30), execution("e3", 20)], total: 4, start: 0, next: "e3" });
    assert.deepEqual(await store.page({ limit: 2, before: "e3" }), { items: [execution("e2", 20), execution("e1", 10)], total: 4, start: 2 });
    assert.deepEqual(await store.page({ limit: 1, before: "e2" }), { items: [execution("e1", 10)], total: 4, start: 3 });
    await assert.rejects(store.page({ limit: 2, before: "gone" }), UnknownExecutionError);
  });

  it("are read by what came of their tests: failing when one of them failed, passing when none did", async () => {
    const failing = execution("e1", 10, { results: [result("Search an order"), result("Filter", { verdict: "failed" })] });
    const passing = execution("e2", 20, { results: [result("Search an order", { verdict: "flaky" })] });
    await store.add(failing);
    await store.add(passing);
    assert.deepEqual(
      [await store.page({ limit: 25, outcome: "failing" }), await store.page({ limit: 25, outcome: "passing" })],
      [
        { items: [failing], total: 1, start: 0 },
        { items: [passing], total: 1, start: 0 },
      ],
    );
  });

  it("are read from a date on, counted and ranked among those the date keeps", async () => {
    for (const [id, seconds] of [
      ["e1", 10],
      ["e2", 20],
      ["e3", 30],
    ] as const)
      await store.add(execution(id, seconds, id === "e2" ? { results: [result("Filter", { verdict: "failed" })] } : {}));
    assert.deepEqual(
      [
        await store.page({ limit: 1, since: at(20) }),
        await store.page({ limit: 1, since: at(20), before: "e3" }),
        await store.page({ limit: 25, since: at(15), outcome: "passing" }),
      ],
      [
        { items: [execution("e3", 30)], total: 2, start: 0, next: "e3" },
        { items: [execution("e2", 20, { results: [result("Filter", { verdict: "failed" })] })], total: 2, start: 1 },
        { items: [execution("e3", 30)], total: 1, start: 0 },
      ],
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
    assert.deepEqual(await store.page({ limit: 25 }), { items: [execution("e1", 10, { results: [result("Search an order")] })], total: 1, start: 0 });
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

  it("number the versions of a test by its digest, each taking the commit of the first execution that ran it committed", async () => {
    const search = (digest: string, committed?: boolean, extra: Partial<ExecutionResult> = {}) =>
      result("Search an order", { testDigest: digest, ...(committed === undefined ? {} : { committed }), ...extra });
    await store.add(
      execution("e1", 10, {
        commit: "c1",
        results: [
          search("d1", false),
          search("d1", false, { project: "mobile" }),
          result("Filter", { testDigest: "d9" }),
          result("Pay", { path: "apps/shop/tests/orders/pay.spec.ts", testDigest: "d1" }),
          result("Sort"),
        ],
      }),
    );
    await store.add(execution("e2", 20, { commit: "c2", results: [search("d1", true)] }));
    await store.add(execution("e3", 30, { commit: "c3", results: [search("d2", false)] }));
    await store.add(execution("e4", 40, { commit: "c4", results: [search("d2", true)] }));
    await store.add(execution("e5", 50, { commit: "c5", results: [search("d1", true)] }));
    await store.add(execution("e6", 60, { commit: "c6", results: [search("d1", true)] }));
    assert.deepEqual(
      (await store.get("e1"))?.results.map(({ title, project, version }) => [title, project, version]),
      [
        ["Search an order", "shop", 1],
        ["Search an order", "mobile", 1],
        ["Filter", "shop", 1],
        ["Pay", "shop", 1],
        ["Sort", "shop", undefined],
      ],
    );
    assert.deepEqual((await store.get("e4"))?.results, [search("d2", true, { version: 2 })]);
    assert.deepEqual(await store.versions("apps/shop/tests/orders/search.spec.ts"), [
      { path: "apps/shop/tests/orders/search.spec.ts", title: "Search an order", number: 3, digest: "d1", commit: "c5", since: at(50), executions: 2 },
      { path: "apps/shop/tests/orders/search.spec.ts", title: "Search an order", number: 2, digest: "d2", commit: "c4", since: at(30), executions: 2 },
      { path: "apps/shop/tests/orders/search.spec.ts", title: "Filter", number: 1, digest: "d9", since: at(10), executions: 1 },
      { path: "apps/shop/tests/orders/search.spec.ts", title: "Search an order", number: 1, digest: "d1", commit: "c2", since: at(10), executions: 2 },
    ]);
  });
});
