import assert from "node:assert/strict";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { ExecutionStore } from "../../src/executions/execution-store.ts";
import { at } from "../support/at.ts";
import { engineUnderTest } from "../support/database-engine.ts";
import { SessionDatabase } from "../support/session-database.ts";
import type { Execution, ExecutionResult } from "@open-qa-stack/domain";

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
    assert.deepEqual(await store.list(), []);
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
    assert.deepEqual(await store.list(), [second, execution("e0", 20), first]);
  });

  it("keep an execution whole or not at all: one under an identifier already kept adds nothing", async () => {
    await store.add(execution("e1", 10, { results: [result("Search an order")] }));
    await assert.rejects(store.add(execution("e1", 20, { results: [result("Another")] })));
    assert.deepEqual(await store.list(), [execution("e1", 10, { results: [result("Search an order")] })]);
  });

  it("keep the executions of a session once the session goes, without it", async () => {
    const { kysely } = database.database;
    await kysely
      .insertInto("sessions")
      .values({ id: "s1", opened_at: at(0), last_event_at: at(0), state: "completed" })
      .execute();
    await store.add(execution("e1", 10, { sessionId: "s1", results: [result("Search an order")] }));
    await kysely.deleteFrom("sessions").execute();
    assert.deepEqual(await store.list(), [execution("e1", 10, { results: [result("Search an order")] })]);
  });
});
