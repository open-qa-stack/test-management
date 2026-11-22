import assert from "node:assert/strict";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { ExecutionStore } from "../../src/executions/execution-store.ts";
import { TestStore } from "../../src/tests/test-store.ts";
import { at } from "../support/at.ts";
import { engineUnderTest } from "../support/database-engine.ts";
import { SessionDatabase } from "../support/session-database.ts";

const engine = engineUnderTest();

let database: SessionDatabase;
let store: TestStore;
let executions: ExecutionStore;
beforeAll(async () => {
  database = await SessionDatabase.create(engine);
  store = new TestStore(database.database);
  executions = new ExecutionStore(database.database);
});
beforeEach(() => database.clear());
afterAll(() => database.drop());

const PATH = "apps/shop/tests/orders/search.spec.ts";
const ID = "3f0c2b9e-8d4a-4f1e-9b7a-2c5d6e7f8a90";

/** Keeps an execution of one test of the orders, at a number of seconds after the start of the tests. */
async function ran(id: string, seconds: number, title: string, digest: string): Promise<void> {
  await executions.add({
    id,
    origin: "design",
    ranAt: at(seconds),
    report: `.oqas/runs/run-${id}/report.json`,
    results: [{ path: PATH, title, project: "shop", verdict: "passed", durationMs: 10, testDigest: digest }],
  });
}

/** The tests the store keeps, in the order of their identifiers. */
const kept = () => database.database.kysely.selectFrom("tests").selectAll().orderBy("id").execute();

/** The titles the versions and the results of the file are kept under. */
async function history(): Promise<{ versions: string[]; results: string[] }> {
  return {
    versions: (await executions.versions(PATH)).map(({ title, number }) => `${title} #${number}`),
    results: (await executions.ofFile(PATH, 10)).map(({ result }) => result.title),
  };
}

describe("the tests the store keeps under their identifiers", () => {
  it("are kept where the repository tells them, once, and nothing is written for none", async () => {
    await store.identify([]);
    await store.identify([{ id: ID, path: PATH, title: "Search an order" }]);
    await store.identify([{ id: ID, path: PATH, title: "Search an order" }]);
    assert.deepEqual(await kept(), [{ id: ID, path: PATH, title: "Search an order" }]);
  });

  it("keep their versions, their results and the campaigns that chose them when they are renamed or moved", async () => {
    await ran("e1", 1, "Search an order", "d1");
    await database.database.kysely
      .insertInto("campaigns")
      .values({ id: "c1", name: "Release", environment: "local", status: "planned", created_at: at(0) })
      .execute();
    await database.database.kysely.insertInto("campaign_tests").values({ campaign_id: "c1", path: PATH, title: "Search an order" }).execute();
    await store.identify([{ id: ID, path: PATH, title: "Search an order" }]);
    await store.identify([{ id: ID, path: PATH, title: "Find an order" }]);
    await ran("e2", 2, "Find an order", "d2");
    assert.deepEqual(await history(), { versions: ["Find an order #2", "Find an order #1"], results: ["Find an order", "Find an order"] });
    const chosen = await database.database.kysely.selectFrom("campaign_tests").select("title").execute();
    assert.deepEqual(chosen, [{ title: "Find an order" }]);
    assert.deepEqual(await kept(), [{ id: ID, path: PATH, title: "Find an order" }]);
  });

  it("bring the history of a test from where it was before its first change, even once a listing kept the new place", async () => {
    await ran("e1", 1, "Search an order", "d1");
    await store.identify([{ id: ID, path: PATH, title: "Find an order" }]);
    await store.identify([{ id: ID, path: PATH, title: "Find an order", was: { path: PATH, title: "Search an order" } }]);
    assert.deepEqual(await history(), { versions: ["Find an order #1"], results: ["Find an order"] });
  });

  it("leave the history where it is when the new place has versions of its own", async () => {
    await ran("e1", 1, "Search an order", "d1");
    await ran("e2", 2, "Find an order", "d2");
    await store.identify([{ id: ID, path: PATH, title: "Find an order", was: { path: PATH, title: "Search an order" } }]);
    assert.deepEqual(await history(), { versions: ["Find an order #1", "Search an order #1"], results: ["Find an order", "Search an order"] });
    assert.deepEqual(await kept(), [{ id: ID, path: PATH, title: "Find an order" }]);
  });
});
