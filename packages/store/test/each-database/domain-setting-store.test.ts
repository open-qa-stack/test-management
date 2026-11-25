import assert from "node:assert/strict";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { DomainSettingStore } from "../../src/domains/domain-setting-store.ts";
import { engineUnderTest } from "../support/database-engine.ts";
import { SessionDatabase } from "../support/session-database.ts";

let database: SessionDatabase;
let store: DomainSettingStore;
beforeAll(async () => {
  database = await SessionDatabase.create(engineUnderTest());
  store = new DomainSettingStore(database.database);
});
beforeEach(() => database.clear());
afterAll(() => database.drop());

describe("the settings of the domains the store keeps", () => {
  it("are listed by identifier, replaced, and forgotten", async () => {
    assert.deepEqual(await store.list(), []);
    await store.set({ id: "orders", label: "Ventes", excluded: false });
    await store.set({ id: "customers", excluded: true });
    assert.deepEqual(await store.list(), [
      { id: "customers", excluded: true },
      { id: "orders", label: "Ventes", excluded: false },
    ]);
    await store.set({ id: "orders", excluded: true });
    await store.remove([]);
    await store.remove(["customers", "gone"]);
    assert.deepEqual(await store.list(), [{ id: "orders", excluded: true }]);
  });
});
