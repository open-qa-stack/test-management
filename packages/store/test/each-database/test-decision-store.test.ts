import assert from "node:assert/strict";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { TestDecisionStore } from "../../src/reviews/test-decision-store.ts";
import { engineUnderTest } from "../support/database-engine.ts";
import { SessionDatabase } from "../support/session-database.ts";

let database: SessionDatabase;
let store: TestDecisionStore;
beforeAll(async () => {
  database = await SessionDatabase.create(engineUnderTest());
  store = new TestDecisionStore(database.database);
});
beforeEach(() => database.clear());
afterAll(() => database.drop());

describe("the decisions of the review the store keeps", () => {
  it("are listed by test, each in place of the one before, with the reason of a test set aside", async () => {
    assert.deepEqual(await store.list(), []);
    await store.set({ id: "b", status: "validated", at: "2026-11-27T10:00:00.000Z" });
    await store.set({
      id: "a",
      status: "set_aside",
      at: "2026-11-27T10:01:00.000Z",
      reason: "covered",
      coveredBy: "apps/shop/tests/x.spec.ts",
      note: "Same steps.",
    });
    await store.set({ id: "c", status: "set_aside", at: "2026-11-27T10:02:00.000Z", reason: "out_of_scope" });
    assert.deepEqual(await store.list(), [
      { id: "a", status: "set_aside", at: "2026-11-27T10:01:00.000Z", reason: "covered", coveredBy: "apps/shop/tests/x.spec.ts", note: "Same steps." },
      { id: "b", status: "validated", at: "2026-11-27T10:00:00.000Z" },
      { id: "c", status: "set_aside", at: "2026-11-27T10:02:00.000Z", reason: "out_of_scope" },
    ]);
    await store.set({ id: "a", status: "validated", at: "2026-11-27T11:00:00.000Z" });
    assert.deepEqual((await store.list())[0], { id: "a", status: "validated", at: "2026-11-27T11:00:00.000Z" });
  });
});
