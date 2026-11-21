import { randomUUID } from "node:crypto";
import {
  campaignCounts,
  campaignResults,
  campaignTransition,
  CampaignRefusedError,
  chosenTests,
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
  type LaunchState,
  type RepositoryTest,
  type TestLaunch,
} from "@open-qa-stack/domain";

/** What the operations on campaigns work with. */
export interface CampaignsHost {
  /** Where the campaigns are kept. */
  readonly store: CampaignStorePort;
  /** Where the executions of their tests are kept. */
  readonly executions: ExecutionStorePort;
  /** The tests of the repository, which the tests chosen for a campaign are among. */
  readonly tests: { list(): Promise<RepositoryTest[]> };
  /** What launches tests: the operations on sessions, whose turn a launch takes. */
  readonly launcher: { launch(request: LaunchRequest): Promise<TestLaunch>; launches(): Promise<LaunchState> };
  /** The clock; that of the machine by default. */
  readonly now?: () => Date;
}

/**
 * The operations on the campaigns of the instance: plan one, fix its tests, launch them, close it, and read what came
 * of each test. Whatever shows them — a REST API, a terminal — calls these and holds no rule of its own.
 *
 * @remarks
 * A campaign is made of tests of the repository chosen one by one, which may change while it is planned; when it
 * becomes ready, they are fixed. Its tests are launched as any test is, in the turn of the sessions, and their execution
 * belongs to it: what came of a test in the campaign is its verdict in the latest of them that ran it.
 */
export class Campaigns {
  readonly #host: CampaignsHost;

  /** @param host - Where the campaigns and their executions are kept, the tests of the repository, and what launches them. */
  constructor(host: CampaignsHost) {
    this.#host = host;
  }

  /**
   * Plans a campaign, with no test yet.
   *
   * @param plan - Its name and its environment.
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
    return Promise.all(
      campaigns.map(async (campaign) => {
        const executions = campaign.status === "planned" ? [] : await this.#host.executions.ofCampaign(campaign.id);
        return { ...campaign, counts: campaignCounts(campaignResults(campaign.tests, executions)) };
      }),
    );
  }

  /**
   * @param id - The identifier of a campaign.
   * @returns The campaign with what came of each of its tests: none run for one planned.
   * @throws `UnknownCampaignError` when the instance keeps none under the identifier.
   */
  async progress(id: string): Promise<CampaignProgress> {
    const campaign = await this.#campaign(id);
    const executions = campaign.status === "planned" ? [] : await this.#host.executions.ofCampaign(id);
    return { campaign, results: campaignResults(campaign.tests, executions) };
  }

  /**
   * Chooses the tests of a planned campaign, in place of those chosen before.
   *
   * @param tests - Tests of the repository, by the path of their file and their title, in any order.
   * @returns The campaign, with its tests in the order of their paths then their titles, each once.
   * @throws `UnknownCampaignError` when the instance keeps none under the identifier.
   * @throws `CampaignRefusedError` when it is no longer planned, or a test is not one of the repository.
   */
  async choose(id: string, tests: readonly CampaignTest[]): Promise<Campaign> {
    const campaign = await this.#campaign(id);
    if (campaign.status !== "planned") throw new CampaignRefusedError(`A campaign ${campaign.status} keeps the tests it fixed: plan another to choose others.`);
    const listed = new Set((await this.#host.tests.list()).map(({ path, title }) => `${path}\n${title}`));
    const unknown = tests.filter(({ path, title }) => !listed.has(`${path}\n${title}`));
    if (unknown.length > 0)
      throw new CampaignRefusedError(
        `The test repository holds no test ${unknown.map(({ path, title }) => `${title} (${path})`).join(", ")}: list its tests again.`,
      );
    await this.#host.store.choose(id, chosenTests(tests));
    return this.#campaign(id);
  }

  /**
   * Fixes the tests chosen for a planned campaign, which becomes ready.
   *
   * @returns The campaign, ready, with its tests.
   * @throws `UnknownCampaignError` when the instance keeps none under the identifier.
   * @throws `CampaignRefusedError` when it is not planned, or no test is chosen for it.
   */
  async ready(id: string): Promise<Campaign> {
    const campaign = await this.#campaign(id);
    campaignTransition(campaign.status, "ready");
    if (campaign.tests.length === 0) throw new CampaignRefusedError("No test is chosen for the campaign: choose its tests before it becomes ready.");
    await this.#host.store.ready(id, this.#now().toISOString());
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
    // Of two first launches at once, the first puts it in progress: the second finds it there already.
    if (campaign.status === "ready") await this.#host.store.move(id, "ready", "in_progress");
    return launch;
  }

  /**
   * Closes a campaign in progress, for good, once no launch of it runs: the results of a closed campaign are fixed.
   *
   * @returns The campaign, closed.
   * @throws `UnknownCampaignError` when the instance keeps none under the identifier.
   * @throws `CampaignRefusedError` when it is not in progress, when a launch of it runs, or when it was closed meanwhile.
   */
  async close(id: string): Promise<Campaign> {
    const campaign = await this.#campaign(id);
    campaignTransition(campaign.status, "closed");
    if ((await this.#host.launcher.launches()).running?.campaign === id)
      throw new CampaignRefusedError("A launch of the campaign runs: close the campaign once it ended, so that its results are fixed.");
    if (!(await this.#host.store.move(id, "in_progress", "closed", this.#now().toISOString())))
      throw new CampaignRefusedError("The campaign was closed meanwhile.");
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

  #now(): Date {
    return (this.#host.now ?? (() => new Date()))();
  }
}
