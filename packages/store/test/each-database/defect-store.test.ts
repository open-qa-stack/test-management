import assert from "node:assert/strict";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { DefectStore } from "../../src/defects/defect-store.ts";
import { engineUnderTest } from "../support/database-engine.ts";
import { SessionDatabase } from "../support/session-database.ts";

let database: SessionDatabase;
let store: DefectStore;
beforeAll(async () => {
  database = await SessionDatabase.create(engineUnderTest());
  store = new DefectStore(database.database);
});
beforeEach(() => database.clear());
afterAll(() => database.drop());

const TEST = { path: "apps/shop/tests/orders/listing/list-orders.spec.ts", title: "The orders are listed" };

describe("the defects the store keeps", () => {
  it("are numbered as they are reported, listed the latest first, read by their reference, and moved", async () => {
    assert.deepEqual(await store.list(), []);
    const first = await store.add(
      { title: "The total is wrong", severity: "S2", description: "It shows 0.", test: TEST, execution: "e1" },
      "2026-11-27T10:00:00.000Z",
    );
    assert.deepEqual(first, {
      id: "D-1",
      title: "The total is wrong",
      severity: "S2",
      description: "It shows 0.",
      test: TEST,
      execution: "e1",
      status: "open",
      openedAt: "2026-11-27T10:00:00.000Z",
    });
    const second = await store.add({ title: "No paging", severity: "S4", description: "", test: TEST }, "2026-11-27T11:00:00.000Z");
    assert.equal(second.id, "D-2");
    assert.deepEqual(
      (await store.list()).map(({ id }) => id),
      ["D-2", "D-1"],
    );
    await store.set({ ...first, status: "fixed", fixedAt: "2026-11-27T12:00:00.000Z" });
    assert.deepEqual(await store.get("D-1"), { ...first, status: "fixed", fixedAt: "2026-11-27T12:00:00.000Z" });
    await store.set({ ...second, status: "closed", closedAt: "2026-11-27T13:00:00.000Z" });
    assert.deepEqual(await store.get("D-2"), { ...second, status: "closed", closedAt: "2026-11-27T13:00:00.000Z" });
    for (const unknown of ["D-9", "D-0", "D-x", "9", "D-"]) assert.equal(await store.get(unknown), undefined, unknown);
  });
});
