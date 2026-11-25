import assert from "node:assert/strict";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { CampaignStore } from "../../src/campaigns/campaign-store.ts";
import { ExecutionStore } from "../../src/executions/execution-store.ts";
import { at } from "../support/at.ts";
import { engineUnderTest } from "../support/database-engine.ts";
import { SessionDatabase } from "../support/session-database.ts";
import type { Campaign } from "@open-qa-stack/domain";

const engine = engineUnderTest();

let database: SessionDatabase;
let store: CampaignStore;
let executions: ExecutionStore;
beforeAll(async () => {
  database = await SessionDatabase.create(engine);
  store = new CampaignStore(database.database);
  executions = new ExecutionStore(database.database);
});
beforeEach(() => database.clear());
afterAll(() => database.drop());

const planned = (id: string, seconds: number): Campaign => ({
  id,
  name: `Recette ${id}`,
  environment: "local",
  status: "planned",
  createdAt: at(seconds),
  tests: [],
});

describe("the campaigns the store keeps", () => {
  it("gives back a campaign as it was planned, the latest planned first, and none for an identifier it does not keep", async () => {
    await store.add(planned("c1", 1));
    const told = { ...planned("c2", 2), objective: "Ship", targetVersion: "4.2", startsOn: "2026-12-01", endsOn: "2026-12-05", owner: "QA" };
    await store.add(told);
    assert.deepEqual(await store.get("c1"), planned("c1", 1));
    assert.deepEqual(await store.list(), [told, planned("c1", 1)]);
    assert.equal(await store.get("c3"), undefined);
  });

  it("keeps the tests chosen for a campaign in the order of their paths then their titles, replaces them, fixes them as it becomes ready, then moves it on to closed", async () => {
    await store.add(planned("c1", 1));
    await store.choose("c1", [{ path: "apps/old.spec.ts", title: "Old" }]);
    const tests = [
      { path: "apps/b.spec.ts", title: "B" },
      { path: "apps/a.spec.ts", title: "Z" },
      { path: "apps/a.spec.ts", title: "A" },
    ];
    await store.choose("c1", tests);
    await store.ready("c1", at(5));
    assert.deepEqual(await store.get("c1"), {
      ...planned("c1", 1),
      status: "ready",
      readyAt: at(5),
      tests: tests.toSorted((a, b) => a.path.localeCompare(b.path) || a.title.localeCompare(b.title)),
    });
    assert.equal(await store.move("c1", "ready", "in_progress"), true);
    assert.equal((await store.get("c1"))?.status, "in_progress");
    // A change from a state the campaign left is not made: of two closures at once, one only is.
    assert.equal(await store.move("c1", "ready", "in_progress"), false);
    const [first, second] = await Promise.all([store.move("c1", "in_progress", "closed", at(9)), store.move("c1", "in_progress", "closed", at(10))]);
    assert.deepEqual([first, second].filter(Boolean).length, 1);
    const closed = await store.get("c1");
    assert.equal(closed?.status, "closed");
    assert.equal(closed?.tests.length, 3);
  });

  it("keeps no test when none is chosen", async () => {
    await store.add(planned("c1", 1));
    await store.choose("c1", [{ path: "apps/a.spec.ts", title: "A" }]);
    await store.choose("c1", []);
    assert.deepEqual(await store.get("c1"), planned("c1", 1));
  });

  it("keeps with an execution the campaign it was launched for, and gives back the executions of a campaign, the latest first", async () => {
    await store.add(planned("c1", 1));
    const result = { path: "apps/a.spec.ts", title: "A", project: "shop", verdict: "passed" as const, durationMs: 10 };
    const launched = (id: string, seconds: number, campaignId?: string) => ({
      id,
      origin: campaignId === undefined ? ("manual" as const) : ("campaign" as const),
      ...(campaignId === undefined ? {} : { campaignId }),
      ranAt: at(seconds),
      report: `.oqas/runs/run-${id}/report.json`,
      results: [result],
    });
    await executions.add(launched("e1", 2, "c1"));
    await executions.add(launched("e2", 3));
    await executions.add(launched("e3", 4, "c1"));
    assert.deepEqual(await executions.ofCampaign("c1"), [launched("e3", 4, "c1"), launched("e1", 2, "c1")]);
    assert.deepEqual((await executions.get("e2"))?.campaignId, undefined);
    assert.deepEqual(
      (await executions.ofFile("apps/a.spec.ts", 10)).map(({ campaignId }) => campaignId),
      ["c1", undefined, "c1"],
    );
    assert.deepEqual(await executions.ofCampaign("c2"), []);
  });
});
