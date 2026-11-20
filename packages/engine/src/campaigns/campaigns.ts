import { randomUUID } from "node:crypto";
import {
  campaignCounts,
  campaignResults,
  campaignTransition,
  CampaignRefusedError,
  scopedTests,
  UnknownCampaignError,
  type Campaign,
  type CampaignLaunchScope,
  type CampaignOverview,
  type CampaignPlan,
  type CampaignProgress,
  type CampaignStorePort,
  type CampaignTest,
  type ExecutionStorePort,
  type LaunchRequest,
  type RepositoryTest,
  type TestLaunch,
} from "@open-qa-stack/domain";

/** What the operations on campaigns work with. */
export interface CampaignsHost {
  /** Where the campaigns are kept. */
  readonly store: CampaignStorePort;
  /** Where the executions of their tests are kept. */
  readonly executions: ExecutionStorePort;
  /** The tests of the repository, each with its tags. */
  readonly tests: { list(): Promise<RepositoryTest[]> };
  /** What launches tests: the operations on sessions, whose turn a launch takes. */
  readonly launcher: { launch(request: LaunchRequest): Promise<TestLaunch> };
  /** The clock; that of the machine by default. */
  readonly now?: () => Date;
}

/**
 * The operations on the campaigns of the instance: plan one, fix its tests, launch them, close it, and read what came
 * of each test. Whatever shows them — a REST API, a terminal — calls these and holds no rule of its own.
 *
 * @remarks
 * A campaign takes the tests of the repository that bear one of the tags of its scope, every test when it names none.
 * While it is planned, its tests are read from the repository as it is; when it becomes ready, they are fixed, and a
 * test added afterwards does not enter it. Its tests are launched as any test is, in the turn of the sessions, and their
 * execution belongs to it: what came of a test in the campaign is its verdict in the latest of them that ran it.
 */
export class Campaigns {
  readonly #host: CampaignsHost;

  /** @param host - Where the campaigns and their executions are kept, the tests of the repository, and what launches them. */
  constructor(host: CampaignsHost) {
    this.#host = host;
  }

  /**
   * Plans a campaign.
   *
   * @param plan - Its name, its environment and its scope.
   * @returns The campaign, planned.
   */
  async plan(plan: CampaignPlan): Promise<Campaign> {
    const campaign: Campaign = { ...plan, id: randomUUID(), status: "planned", createdAt: this.#now().toISOString(), tests: [] };
    await this.#host.store.add(campaign);
    return campaign;
  }

  /** @returns Every campaign, the latest planned first, with how many of its tests came to each verdict. */
  async list(): Promise<CampaignOverview[]> {
    const campaigns = await this.#host.store.list();
    // The tests of the repository are read once, for the campaigns still planned.
    const listed = campaigns.some(({ status }) => status === "planned") ? await this.#host.tests.list() : [];
    return Promise.all(
      campaigns.map(async (campaign) => {
        const results =
          campaign.status === "planned"
            ? campaignResults(scopedTests(campaign.scope, listed), [])
            : campaignResults(campaign.tests, await this.#host.executions.ofCampaign(campaign.id));
        return { ...campaign, counts: campaignCounts(results) };
      }),
    );
  }

  /**
   * @param id - The identifier of a campaign.
   * @returns The campaign with what came of each of its tests: for one planned, the tests its scope takes now, none run.
   * @throws `UnknownCampaignError` when the instance keeps none under the identifier.
   */
  async progress(id: string): Promise<CampaignProgress> {
    const campaign = await this.#campaign(id);
    if (campaign.status === "planned") return { campaign, results: campaignResults(await this.#scoped(campaign), []) };
    return { campaign, results: campaignResults(campaign.tests, await this.#host.executions.ofCampaign(id)) };
  }

  /**
   * Fixes the tests of a planned campaign, which becomes ready.
   *
   * @returns The campaign, ready, with its tests.
   * @throws `UnknownCampaignError` when the instance keeps none under the identifier.
   * @throws `CampaignRefusedError` when it is not planned, or its scope takes no test of the repository.
   */
  async ready(id: string): Promise<Campaign> {
    const campaign = await this.#campaign(id);
    campaignTransition(campaign.status, "ready");
    const tests = await this.#scoped(campaign);
    if (tests.length === 0)
      throw new CampaignRefusedError(
        campaign.scope.tags.length === 0
          ? "The test repository holds no test: write some before the campaign becomes ready."
          : `No test of the repository bears ${campaign.scope.tags.join(", ")}: plan another campaign with tags its tests bear.`,
      );
    await this.#host.store.ready(id, tests, this.#now().toISOString());
    return this.#campaign(id);
  }

  /**
   * Launches the tests of a campaign that is ready, or in progress: the files of its tests run against its environment.
   * Its first launch puts it in progress.
   *
   * @param id - The identifier of the campaign.
   * @param only - Which of its tests: those that failed, or those no execution of it ran yet; every one when left out.
   * @returns The launch, which runs.
   * @throws `UnknownCampaignError` when the instance keeps none under the identifier.
   * @throws `CampaignRefusedError` when it is planned or closed, or when none of its tests is of those asked for.
   * @throws What the launch raises: `LaunchRefusedError` while a session or another launch runs, among others.
   */
  async launch(id: string, only?: CampaignLaunchScope): Promise<TestLaunch> {
    const campaign = await this.#campaign(id);
    if (campaign.status !== "in_progress") campaignTransition(campaign.status, "in_progress");
    const tests = only === undefined ? campaign.tests : await this.#only(campaign, only);
    const paths = [...new Set(tests.map(({ path }) => path))];
    const launch = await this.#host.launcher.launch({ paths, environment: campaign.environment, campaign: id });
    if (campaign.status === "ready") await this.#host.store.move(id, "in_progress");
    return launch;
  }

  /**
   * Closes a campaign in progress, for good.
   *
   * @returns The campaign, closed.
   * @throws `UnknownCampaignError` when the instance keeps none under the identifier.
   * @throws `CampaignRefusedError` when it is not in progress.
   */
  async close(id: string): Promise<Campaign> {
    const campaign = await this.#campaign(id);
    campaignTransition(campaign.status, "closed");
    await this.#host.store.move(id, "closed", this.#now().toISOString());
    return this.#campaign(id);
  }

  /** The tests of a campaign whose verdict is the one asked for; `CampaignRefusedError` when there is none. */
  async #only(campaign: Campaign, only: CampaignLaunchScope): Promise<readonly CampaignTest[]> {
    const results = campaignResults(campaign.tests, await this.#host.executions.ofCampaign(campaign.id));
    const tests = results.filter(({ verdict }) => verdict === only);
    if (tests.length === 0)
      throw new CampaignRefusedError(
        only === "failed"
          ? "No test of the campaign failed: there is nothing to launch again."
          : "Every test of the campaign ran already: launch them all again instead.",
      );
    return tests;
  }

  /** The campaign of an identifier; `UnknownCampaignError` when there is none. */
  async #campaign(id: string): Promise<Campaign> {
    const campaign = await this.#host.store.get(id);
    if (campaign === undefined) throw new UnknownCampaignError(id);
    return campaign;
  }

  /** The tests of the repository the scope of a campaign takes now. */
  async #scoped(campaign: Campaign): Promise<ReturnType<typeof scopedTests>> {
    return scopedTests(campaign.scope, await this.#host.tests.list());
  }

  #now(): Date {
    return (this.#host.now ?? (() => new Date()))();
  }
}
