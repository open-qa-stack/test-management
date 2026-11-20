import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CampaignRefusedError, LaunchRefusedError, UnknownCampaignError, type RepositoryTest } from "@open-qa-stack/domain";
import { afterEach, describe, it } from "vitest";
import { Campaigns } from "../src/index.ts";
import { eventually } from "./support/eventually.ts";
import { Hosted } from "./support/hosted.ts";
import { MemoryCampaignStore } from "./support/memory-campaign-store.ts";

const QUOTES = "apps/shop/tests/quotes.spec.ts";
const ORDERS = "apps/shop/tests/orders.spec.ts";
const LOGIN = "apps/shop/tests/login.spec.ts";

/** A test of the repository, as its listing gives it. */
const listed = (path: string, title: string, tags: readonly string[]): RepositoryTest => ({ path, title, steps: [], tags, applications: [] });

let hosted: Hosted;
afterEach(() => hosted.close());

/** The operations on campaigns over a test repository whose tests the listing gives, launched by its sessions. */
async function campaignsOf(
  tests: RepositoryTest[],
  setup: Parameters<typeof Hosted.create>[1] = {},
): Promise<{ campaigns: Campaigns; store: MemoryCampaignStore }> {
  hosted = await Hosted.create([], setup);
  mkdirSync(join(hosted.root, "apps/shop/tests"), { recursive: true });
  for (const { path, title } of tests) writeFileSync(join(hosted.root, path), `test(${JSON.stringify(title)}, async () => {});\n`);
  const store = new MemoryCampaignStore();
  let clock = Date.parse("2026-11-20T08:00:00.000Z");
  const campaigns = new Campaigns({
    store,
    executions: hosted.executions,
    tests: { list: () => Promise.resolve(tests) },
    launcher: hosted.sessions,
    now: () => new Date((clock += 1000)),
  });
  return { campaigns, store };
}

const REPOSITORY = [listed(QUOTES, "Answer a quote", ["@p0", "@domain-quotes"]), listed(ORDERS, "List the orders", ["@p1"]), listed(LOGIN, "Log in", [])];

describe("a campaign", () => {
  it("is planned with the tests its scope takes now, none run, then fixes them when it becomes ready", async () => {
    const { campaigns } = await campaignsOf(REPOSITORY);
    const planned = await campaigns.plan({ name: "Recette 4.2", environment: "local", scope: { tags: ["@p0", "@p1"] } });
    assert.match(planned.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(planned, {
      name: "Recette 4.2",
      environment: "local",
      scope: { tags: ["@p0", "@p1"] },
      id: planned.id,
      status: "planned",
      createdAt: "2026-11-20T08:00:01.000Z",
      tests: [],
    });
    assert.deepEqual((await campaigns.progress(planned.id)).results, [
      { path: ORDERS, title: "List the orders", verdict: "not_run" },
      { path: QUOTES, title: "Answer a quote", verdict: "not_run" },
    ]);
    const ready = await campaigns.ready(planned.id);
    assert.deepEqual([ready.status, ready.readyAt, ready.tests.map(({ path }) => path)], ["ready", "2026-11-20T08:00:02.000Z", [ORDERS, QUOTES]]);
    const every = await campaigns.plan({ name: "Tout", environment: "local", scope: { tags: [] } });
    assert.deepEqual(
      (await campaigns.ready(every.id)).tests.map(({ path }) => path),
      [LOGIN, ORDERS, QUOTES],
    );
    assert.deepEqual(
      (await campaigns.list()).map(({ name }) => name),
      ["Tout", "Recette 4.2"],
    );
  });

  it("launches the files of its tests in its environment, goes in progress, and gives each test its verdict in its latest execution", async () => {
    const { campaigns } = await campaignsOf(REPOSITORY);
    const { id } = await campaigns.plan({ name: "Recette", environment: "local", scope: { tags: ["@p0"] } });
    await campaigns.ready(id);
    const launch = await campaigns.launch(id);
    assert.deepEqual([launch.paths, launch.environment, launch.campaign], [[QUOTES], "local", id]);
    assert.equal((await campaigns.progress(id)).campaign.status, "in_progress");
    const done = await eventually(async () => {
      const { results } = await campaigns.progress(id);
      assert.ok(results[0]?.verdict !== "not_run");
      return results;
    });
    const [execution] = await hosted.executions.ofCampaign(id);
    assert.deepEqual(done, [{ path: QUOTES, title: "Answer a quote", verdict: "passed", execution: execution!.id, ranAt: execution!.ranAt }]);
    assert.deepEqual([execution!.origin, execution!.campaignId], ["campaign", id]);
    await eventually(async () => assert.equal((await hosted.sessions.launches()).running, undefined));
    await campaigns.launch(id);
    await eventually(async () => assert.equal((await hosted.executions.ofCampaign(id)).length, 2));
    assert.equal((await campaigns.progress(id)).campaign.status, "in_progress");
    const closed = await campaigns.close(id);
    assert.deepEqual([closed.status, closed.closedAt !== undefined], ["closed", true]);
  });

  it("counts in the list how many of its tests came to each verdict, those its scope takes while it is planned", async () => {
    const { campaigns } = await campaignsOf(REPOSITORY, { script: { final: (file: string) => (file.includes("orders") ? "unexpected" : "expected") } });
    const { id } = await campaigns.plan({ name: "Recette", environment: "local", scope: { tags: ["@p0", "@p1"] } });
    await campaigns.plan({ name: "Plus tard", environment: "local", scope: { tags: [] } });
    await campaigns.ready(id);
    await campaigns.launch(id);
    await eventually(async () => assert.equal((await hosted.executions.ofCampaign(id)).length, 1));
    assert.deepEqual(
      (await campaigns.list()).map(({ name, counts }) => [name, counts]),
      [
        ["Plus tard", { passed: 0, failed: 0, flaky: 0, skipped: 0, not_run: 3 }],
        ["Recette", { passed: 1, failed: 1, flaky: 0, skipped: 0, not_run: 0 }],
      ],
    );
  });

  it("launches again only the tests that failed, or those not run, and refuses when there is none", async () => {
    const { campaigns } = await campaignsOf(REPOSITORY, { script: { final: (file: string) => (file.includes("orders") ? "unexpected" : "expected") } });
    const { id } = await campaigns.plan({ name: "Recette", environment: "local", scope: { tags: ["@p0", "@p1"] } });
    await campaigns.ready(id);
    const refused = (message: RegExp) => (error: unknown) => error instanceof CampaignRefusedError && message.test(error.message);
    await assert.rejects(campaigns.launch(id, "failed"), refused(/^No test of the campaign failed/));
    assert.deepEqual((await campaigns.launch(id, "not_run")).paths, [ORDERS, QUOTES]);
    await eventually(async () => assert.equal((await hosted.executions.ofCampaign(id)).length, 1));
    await eventually(async () => assert.equal((await hosted.sessions.launches()).running, undefined));
    await assert.rejects(campaigns.launch(id, "not_run"), refused(/^Every test of the campaign ran already/));
    assert.deepEqual((await campaigns.launch(id, "failed")).paths, [ORDERS]);
  });

  it("refuses what its state does not allow, a scope that takes no test, and a launch the turn of the sessions refuses", async () => {
    const { campaigns } = await campaignsOf(REPOSITORY);
    const { id } = await campaigns.plan({ name: "Recette", environment: "local", scope: { tags: ["@p0"] } });
    const refused = (message: RegExp) => (error: unknown) => error instanceof CampaignRefusedError && message.test(error.message);
    await assert.rejects(campaigns.launch(id), refused(/^A campaign planned cannot become in_progress/));
    await assert.rejects(campaigns.close(id), refused(/^A campaign planned cannot become closed/));
    await campaigns.ready(id);
    await assert.rejects(campaigns.ready(id), refused(/^A campaign ready cannot become ready/));
    await campaigns.launch(id);
    await assert.rejects(campaigns.launch(id), (error) => error instanceof LaunchRefusedError);
    await eventually(async () => assert.equal((await hosted.sessions.launches()).running, undefined));
    await campaigns.close(id);
    await assert.rejects(campaigns.launch(id), refused(/^A campaign closed cannot become in_progress/));
    const none = await campaigns.plan({ name: "Vide", environment: "local", scope: { tags: ["@p3"] } });
    await assert.rejects(campaigns.ready(none.id), refused(/^No test of the repository bears @p3: /));
    await assert.rejects(
      campaigns.progress("nowhere"),
      (error) => error instanceof UnknownCampaignError && error.message === "The instance keeps no campaign nowhere.",
    );
  });

  it("refuses to become ready over a repository that holds no test, and dates with the clock of the machine by default", async () => {
    const { store } = await campaignsOf([]);
    const campaigns = new Campaigns({ store, executions: hosted.executions, tests: { list: () => Promise.resolve([]) }, launcher: hosted.sessions });
    const before = Date.now();
    const { id, createdAt } = await campaigns.plan({ name: "Tout", environment: "local", scope: { tags: [] } });
    assert.ok(Date.parse(createdAt) >= before);
    await assert.rejects(
      campaigns.ready(id),
      (error) => error instanceof CampaignRefusedError && error.message.startsWith("The test repository holds no test"),
    );
  });
});
