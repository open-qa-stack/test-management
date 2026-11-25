import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "vitest";
import { Logger } from "@nestjs/common";
import { SessionDatabase, type DatabaseEngine } from "@open-qa-stack/store/testing";
import { fixtureConfig } from "@open-qa-stack/testing/fixture-repository";
import { eventually } from "../support/eventually.ts";
import { sessionsApi, type TestApi } from "../support/sessions-api.ts";
import type { Campaign, CampaignList, CampaignProgress, LaunchState, Problem, TestLaunch } from "@open-qa-stack/domain/sessions";

const QUOTES = "apps/shop/tests/quotes.spec.ts";
const ORDERS = "apps/shop/tests/orders.spec.ts";

/** Runs the routes of the campaigns on one engine of database. */
export function campaignsApiSuite(engine: DatabaseEngine): void {
  let database: SessionDatabase;
  let repository: string;
  let api: TestApi;
  beforeAll(async () => {
    database = await SessionDatabase.create(engine, new Logger("Database"));
  });
  beforeEach(async () => {
    await database.clear();
    repository = mkdtempSync(join(tmpdir(), "oqas-api-campaigns-"));
    writeFileSync(join(repository, "oqas.json"), fixtureConfig("http://127.0.0.1:9/v1", "http://127.0.0.1:9/"));
    mkdirSync(join(repository, "apps/shop/tests"), { recursive: true });
    writeFileSync(join(repository, QUOTES), 'test("Answer a quote", { tag: ["@p0", "@domain-quotes"] }, async () => {});\n');
    writeFileSync(join(repository, ORDERS), 'test("List the orders", { tag: ["@p1"] }, async () => {});\n');
    // The configuration names the address of a database in a variable of the environment of the runs.
    api = await sessionsApi({ database: database.url, repository, runs: { env: { SHOP_DB_URL: "postgres://shop@127.0.0.1:9/shop" } } });
  });
  afterEach(async () => {
    await api.close();
    rmSync(repository, { recursive: true, force: true });
  });
  afterAll(() => database.drop());

  /** Sends a request to the API, and gives its status and its body. */
  async function call(path: string, method = "GET", body?: unknown): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${api.url}${path}`, {
      method,
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }

  describe(`the campaigns on ${engine.name}`, () => {
    it("are planned, have their tests chosen, become ready, are launched in their environment, go in progress, and are closed", async () => {
      assert.deepEqual(await call("/campaigns"), { status: 200, body: { items: [] } satisfies CampaignList });
      const planned = await call("/campaigns", "POST", { name: " Recette 4.2 ", environment: "local" });
      assert.deepEqual(
        [planned.status, (planned.body as Campaign).name, (planned.body as Campaign).status, (planned.body as Campaign).tests],
        [201, "Recette 4.2", "planned", []],
      );
      const chose = await call(`/campaigns/${(planned.body as Campaign).id}/tests`, "PUT", { tests: [{ path: QUOTES, title: "Answer a quote" }] });
      const campaign = chose.body as Campaign;
      assert.deepEqual([chose.status, campaign.tests], [200, [{ path: QUOTES, title: "Answer a quote" }]]);
      assert.deepEqual((await call(`/campaigns/${campaign.id}`)).body as CampaignProgress, {
        campaign,
        results: [{ path: QUOTES, title: "Answer a quote", verdict: "not_run" }],
      });
      const ready = await call(`/campaigns/${campaign.id}/readiness`, "POST");
      assert.deepEqual([ready.status, (ready.body as Campaign).tests], [200, [{ path: QUOTES, title: "Answer a quote" }]]);
      const launched = await call(`/campaigns/${campaign.id}/launches`, "POST");
      assert.deepEqual([launched.status, (launched.body as TestLaunch).paths, (launched.body as TestLaunch).campaign], [202, [QUOTES], campaign.id]);
      assert.equal(((await call(`/campaigns/${campaign.id}`)).body as CampaignProgress).campaign.status, "in_progress");
      // The test repository installs nothing: the launch ends at once, and says why.
      const last = await eventually(async () => ((await call("/launches")).body as LaunchState).last);
      assert.match(String(last.failure), /package-lock\.json/);
      // The launch ended without a verdict: no test failed, every one is still to run.
      assert.deepEqual(
        [
          (await call(`/campaigns/${campaign.id}/launches`, "POST", { only: "failed" })).status,
          (await call(`/campaigns/${campaign.id}/launches`, "POST", { only: "nothing" })).status,
        ],
        [409, 400],
      );
      const notRun = await call(`/campaigns/${campaign.id}/launches`, "POST", { only: "not_run" });
      assert.deepEqual([notRun.status, (notRun.body as TestLaunch).paths], [202, [QUOTES]]);
      await eventually(async () => ((await call("/launches")).body as LaunchState).running === undefined);
      assert.deepEqual(((await call("/campaigns")).body as CampaignList).items[0]?.counts, { passed: 0, failed: 0, flaky: 0, skipped: 0, not_run: 1 });
      const closed = await call(`/campaigns/${campaign.id}/closure`, "POST");
      assert.deepEqual([closed.status, (closed.body as Campaign).status], [200, "closed"]);
      assert.deepEqual(
        ((await call("/campaigns")).body as CampaignList).items.map(({ id }) => id),
        [campaign.id],
      );
    });

    it("answer 404 for a campaign the instance does not keep, 409 for a change its state does not allow, and 400 for a plan that is not one", async () => {
      const problem = async (path: string, method = "GET", body?: unknown) => {
        const { status, body: told } = await call(path, method, body);
        return [status, (told as Problem).code];
      };
      assert.deepEqual(await problem("/campaigns/nowhere"), [404, "unknown_campaign"]);
      const { id } = (await call("/campaigns", "POST", { name: "Vide", environment: "local" })).body as Campaign;
      assert.deepEqual(await problem(`/campaigns/${id}/readiness`, "POST"), [409, "campaign_refused"]);
      assert.deepEqual(await problem(`/campaigns/${id}/tests`, "PUT", { tests: [{ path: QUOTES, title: "Gone" }] }), [409, "campaign_refused"]);
      assert.deepEqual(await problem(`/campaigns/${id}/tests`, "PUT", { tests: "all" }), [400, "invalid_request"]);
      assert.deepEqual(await problem(`/campaigns/${id}/closure`, "POST"), [409, "campaign_refused"]);
      assert.deepEqual(await problem("/campaigns", "POST", { name: "", environment: "local" }), [400, "invalid_request"]);
    });
  });
}
