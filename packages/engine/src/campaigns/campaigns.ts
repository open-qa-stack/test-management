import { randomUUID } from "node:crypto";
import {
  campaignResults,
  campaignTransition,
  CampaignRefusedError,
  scopedTests,
  UnknownCampaignError,
  type Campaign,
  type CampaignPlan,
  type CampaignProgress,
  type CampaignStorePort,
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

  /** @returns Every campaign, the latest planned first. */
  list(): Promise<Campaign[]> {
    return this.#host.store.list();
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
   * @returns The launch, which runs.
   * @throws `UnknownCampaignError` when the instance keeps none under the identifier.
   * @throws `CampaignRefusedError` when it is planned or closed.
   * @throws What the launch raises: `LaunchRefusedError` while a session or another launch runs, among others.
   */
  async launch(id: string): Promise<TestLaunch> {
    const campaign = await this.#campaign(id);
    if (campaign.status !== "in_progress") campaignTransition(campaign.status, "in_progress");
    const paths = [...new Set(campaign.tests.map(({ path }) => path))];
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
