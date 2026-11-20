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

const planned = (id: string, seconds: number, tags: readonly string[] = ["@p0", "@domain-quotes"]): Campaign => ({
  id,
  name: `Recette ${id}`,
  environment: "local",
  scope: { tags },
  status: "planned",
  createdAt: at(seconds),
  tests: [],
});

describe("the campaigns the store keeps", () => {
  it("gives back a campaign as it was planned, the latest planned first, and none for an identifier it does not keep", async () => {
    await store.add(planned("c1", 1));
    await store.add(planned("c2", 2, []));
    assert.deepEqual(await store.get("c1"), planned("c1", 1));
    assert.deepEqual(await store.list(), [planned("c2", 2, []), planned("c1", 1)]);
    assert.equal(await store.get("c3"), undefined);
  });

  it("fixes the tests of a campaign that becomes ready, in the order of their paths then their titles, then moves it on to closed", async () => {
    await store.add(planned("c1", 1));
    const tests = [
      { path: "apps/b.spec.ts", title: "B" },
      { path: "apps/a.spec.ts", title: "Z" },
      { path: "apps/a.spec.ts", title: "A" },
    ];
    await store.ready("c1", tests, at(5));
    assert.deepEqual(await store.get("c1"), {
      ...planned("c1", 1),
      status: "ready",
      readyAt: at(5),
      tests: tests.toSorted((a, b) => a.path.localeCompare(b.path) || a.title.localeCompare(b.title)),
    });
    await store.move("c1", "in_progress");
    assert.equal((await store.get("c1"))?.status, "in_progress");
    await store.move("c1", "closed", at(9));
    const closed = await store.get("c1");
    assert.deepEqual([closed?.status, closed?.closedAt, closed?.tests.length], ["closed", at(9), 3]);
  });

  it("becomes ready with no test when its scope takes none", async () => {
    await store.add(planned("c1", 1));
    await store.ready("c1", [], at(5));
    assert.deepEqual(await store.get("c1"), { ...planned("c1", 1), status: "ready", readyAt: at(5) });
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
