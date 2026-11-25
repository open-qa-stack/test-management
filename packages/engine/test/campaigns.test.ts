import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CampaignRefusedError, LaunchRefusedError, UnknownCampaignError, type RepositoryTest } from "@open-qa-stack/domain";
import { afterEach, describe, it } from "vitest";
import { Campaigns } from "../src/index.ts";
import { eventually } from "./support/eventually.ts";
import { held } from "./support/held.ts";
import { Hosted } from "./support/hosted.ts";
import { MemoryCampaignStore } from "./support/memory-campaign-store.ts";

/** The title the played runner reports the test of each file under: a campaign finds a test by its file and its title. */
const TITLE = "the test";

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

const REPOSITORY = [listed(QUOTES, TITLE, ["@p0", "@domain-quotes"]), listed(ORDERS, TITLE, ["@p1"]), listed(LOGIN, TITLE, [])];

/** The tests of the repository, by the path of their file and their title, as a campaign chooses them. */
const QUOTE = { path: QUOTES, title: TITLE };
const ORDER = { path: ORDERS, title: TITLE };
const SIGN_IN = { path: LOGIN, title: TITLE };

/** Plans a campaign in the local environment, and chooses its tests. */
/** Tells a refusal of the operations on campaigns whose message matches. */
const refused = (message: RegExp) => (error: unknown) => error instanceof CampaignRefusedError && message.test(error.message);

async function chosen(campaigns: Campaigns, name: string, tests: readonly { path: string; title: string }[]): Promise<string> {
  const { id } = await campaigns.plan({ name, environment: "local" });
  await campaigns.choose(id, tests);
  return id;
}

describe("a campaign", () => {
  it("is planned with what a person says of it, and refused when its days are none of the calendar, or in the wrong order", async () => {
    const { campaigns } = await campaignsOf(REPOSITORY);
    const plan = { name: "R", environment: "local" };
    const details = { objective: "Ship", targetVersion: "4.2", startsOn: "2026-12-01", endsOn: "2026-12-01", owner: "QA" };
    const planned = await campaigns.plan({ ...plan, ...details });
    assert.deepEqual({ ...planned, ...details }, planned);
    for (const day of ["tomorrow", "2026-13-01", "2026-02-30"])
      await assert.rejects(campaigns.plan({ ...plan, startsOn: day }), refused(/is not a day: write it as 2026-12-01\.$/));
    await assert.rejects(
      campaigns.plan({ ...plan, startsOn: "2026-12-02", endsOn: "2026-12-01" }),
      refused(/end on 2026-12-01, before it starts on 2026-12-02/),
    );
    await campaigns.plan({ ...plan, endsOn: "2026-12-01" });
  });

  it("is planned with no test, has its tests chosen in order, chosen again while it is planned, then fixed when it becomes ready", async () => {
    const { campaigns } = await campaignsOf(REPOSITORY);
    const planned = await campaigns.plan({ name: "Recette 4.2", environment: "local" });
    assert.match(planned.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(planned, {
      name: "Recette 4.2",
      environment: "local",
      id: planned.id,
      status: "planned",
      createdAt: "2026-11-20T08:00:01.000Z",
      tests: [],
    });
    await campaigns.choose(planned.id, [SIGN_IN]);
    const chose = await campaigns.choose(planned.id, [QUOTE, ORDER, QUOTE]);
    assert.deepEqual(chose.tests, [ORDER, QUOTE]);
    assert.deepEqual((await campaigns.progress(planned.id)).results, [
      { ...ORDER, verdict: "not_run" },
      { ...QUOTE, verdict: "not_run" },
    ]);
    const ready = await campaigns.ready(planned.id);
    assert.deepEqual([ready.status, ready.readyAt, ready.tests], ["ready", "2026-11-20T08:00:02.000Z", [ORDER, QUOTE]]);
    await chosen(campaigns, "Tout", REPOSITORY);
    assert.deepEqual(
      (await campaigns.list()).map(({ name }) => name),
      ["Tout", "Recette 4.2"],
    );
  });

  it("launches the files of its tests in its environment, goes in progress, and gives each test its verdict in its latest execution", async () => {
    const { campaigns } = await campaignsOf(REPOSITORY);
    const id = await chosen(campaigns, "Recette", [QUOTE]);
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
    assert.deepEqual(done, [{ ...QUOTE, verdict: "passed", execution: execution!.id, ranAt: execution!.ranAt }]);
    assert.deepEqual([execution!.origin, execution!.campaignId], ["campaign", id]);
    await eventually(async () => assert.equal((await hosted.sessions.launches()).running, undefined));
    await campaigns.launch(id);
    await eventually(async () => assert.equal((await hosted.executions.ofCampaign(id)).length, 2));
    assert.equal((await campaigns.progress(id)).campaign.status, "in_progress");
    const closed = await campaigns.close(id);
    assert.deepEqual([closed.status, closed.closedAt !== undefined], ["closed", true]);
  });

  it("counts in the list how many of its tests came to each verdict, every chosen test not run while it is planned", async () => {
    const { campaigns } = await campaignsOf(REPOSITORY, { script: { final: (file: string) => (file.includes("orders") ? "unexpected" : "expected") } });
    const id = await chosen(campaigns, "Recette", [QUOTE, ORDER]);
    await chosen(campaigns, "Plus tard", REPOSITORY);
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
    const id = await chosen(campaigns, "Recette", [QUOTE, ORDER]);
    await campaigns.ready(id);
    await assert.rejects(campaigns.launch(id, "failed"), refused(/^No test of the campaign failed/));
    assert.deepEqual((await campaigns.launch(id, "not_run")).paths, [ORDERS, QUOTES]);
    await eventually(async () => assert.equal((await hosted.executions.ofCampaign(id)).length, 1));
    await eventually(async () => assert.equal((await hosted.sessions.launches()).running, undefined));
    await assert.rejects(campaigns.launch(id, "not_run"), refused(/^Every test of the campaign ran already/));
    assert.deepEqual((await campaigns.launch(id, "failed")).paths, [ORDERS]);
  });

  it("refuses what its state does not allow, no test chosen, a test the repository does not hold, and a launch the turn of the sessions refuses", async () => {
    const { campaigns } = await campaignsOf(REPOSITORY);
    const { id } = await campaigns.plan({ name: "Recette", environment: "local" });
    await assert.rejects(campaigns.ready(id), refused(/^No test is chosen for the campaign: choose its tests before it becomes ready\.$/));
    await assert.rejects(
      campaigns.choose(id, [QUOTE, { path: "apps/shop/tests/gone.spec.ts", title: "Gone" }]),
      refused(/^The test repository holds no test Gone \(apps\/shop\/tests\/gone\.spec\.ts\): list its tests again\.$/),
    );
    await assert.rejects(campaigns.choose(id, [{ path: QUOTES, title: "Another title" }]), refused(/holds no test Another title/));
    await campaigns.choose(id, [QUOTE]);
    await assert.rejects(campaigns.launch(id), refused(/^A campaign planned cannot become in_progress/));
    await assert.rejects(campaigns.close(id), refused(/^A campaign planned cannot become closed/));
    await campaigns.ready(id);
    await assert.rejects(campaigns.ready(id), refused(/^A campaign ready cannot become ready/));
    await assert.rejects(campaigns.choose(id, [ORDER]), refused(/^A campaign ready keeps the tests it fixed: plan another to choose others\.$/));
    await campaigns.launch(id);
    await assert.rejects(campaigns.launch(id), (error) => error instanceof LaunchRefusedError);
    await eventually(async () => assert.equal((await hosted.sessions.launches()).running, undefined));
    await campaigns.close(id);
    await assert.rejects(campaigns.launch(id), refused(/^A campaign closed cannot become in_progress/));
    await assert.rejects(
      campaigns.progress("nowhere"),
      (error) => error instanceof UnknownCampaignError && error.message === "The instance keeps no campaign nowhere.",
    );
  });

  it("is closed once no launch of it runs, and once only: its results stay as they were", async () => {
    // The run of the tests waits until the test lets it go.
    const running = held();
    const { campaigns } = await campaignsOf(REPOSITORY, {
      before: async ({ command }) => {
        if (command.some((arg) => arg.endsWith(".spec.ts"))) await running.promise;
      },
    });
    const id = await chosen(campaigns, "Recette", [QUOTE]);
    await campaigns.ready(id);
    await campaigns.launch(id);
    await assert.rejects(campaigns.close(id), refused(/^A launch of the campaign runs: close the campaign once it ended, so that its results are fixed\.$/));
    running.resolve();
    await eventually(async () => assert.equal((await hosted.sessions.launches()).running, undefined));
    const closing = await Promise.allSettled([campaigns.close(id), campaigns.close(id)]);
    assert.deepEqual(closing.map((outcome) => (outcome.status === "fulfilled" ? outcome.value.status : (outcome.reason as Error).message)).sort(), [
      "The campaign was closed meanwhile.",
      "closed",
    ]);
  });

  it("dates with the clock of the machine by default", async () => {
    const { store } = await campaignsOf([]);
    const campaigns = new Campaigns({ store, executions: hosted.executions, tests: { list: () => Promise.resolve([]) }, launcher: hosted.sessions });
    const before = Date.now();
    const { createdAt } = await campaigns.plan({ name: "Tout", environment: "local" });
    assert.ok(Date.parse(createdAt) >= before);
  });
});
