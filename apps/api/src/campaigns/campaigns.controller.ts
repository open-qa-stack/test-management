import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Put } from "@nestjs/common";
import { Campaigns } from "@open-qa-stack/engine";
import { CampaignLaunchPipe } from "./campaign-launch.pipe.ts";
import { CampaignPlanPipe } from "./campaign-plan.pipe.ts";
import { CampaignTestsPipe } from "./campaign-tests.pipe.ts";
import type { Campaign, CampaignLaunchScope, CampaignTest, CampaignList, CampaignPlan, CampaignProgress, TestLaunch } from "@open-qa-stack/domain/sessions";

/** The operations on the campaigns of the instance, said in HTTP: each route calls one operation, and holds no rule of its own. */
@Controller("campaigns")
export class CampaignsController {
  readonly #campaigns: Campaigns;

  constructor(campaigns: Campaigns) {
    this.#campaigns = campaigns;
  }

  /** @returns Every campaign, the latest planned first, as the items of a list which no cache may keep. */
  @Get()
  @Header("Cache-Control", "no-store")
  async list(): Promise<CampaignList> {
    return { items: await this.#campaigns.list() };
  }

  /** @returns The campaign planned, answered with `201`. */
  @Post()
  plan(@Body(CampaignPlanPipe) plan: CampaignPlan): Promise<Campaign> {
    return this.#campaigns.plan(plan);
  }

  /** @returns The campaign with what came of each of its tests, which no cache may keep. */
  @Get(":id")
  @Header("Cache-Control", "no-store")
  progress(@Param("id") id: string): Promise<CampaignProgress> {
    return this.#campaigns.progress(id);
  }

  /** @returns The campaign, with the tests chosen in place of those before, in order. */
  @Put(":id/tests")
  choose(@Param("id") id: string, @Body(CampaignTestsPipe) tests: readonly CampaignTest[]): Promise<Campaign> {
    return this.#campaigns.choose(id, tests);
  }

  /** @returns The campaign, ready, with the tests it fixed. */
  @Post(":id/readiness")
  @HttpCode(HttpStatus.OK)
  ready(@Param("id") id: string): Promise<Campaign> {
    return this.#campaigns.ready(id);
  }

  /**
   * @param only - The `only` field of the body, when it is given: `failed` or `not_run`, the tests of the campaign to
   * launch; every one without it.
   * @returns The launch of its tests, which runs, answered with `202`.
   */
  @Post(":id/launches")
  @HttpCode(HttpStatus.ACCEPTED)
  launch(@Param("id") id: string, @Body(CampaignLaunchPipe) only: CampaignLaunchScope | undefined): Promise<TestLaunch> {
    return this.#campaigns.launch(id, only);
  }

  /** @returns The campaign, closed. */
  @Post(":id/closure")
  @HttpCode(HttpStatus.OK)
  close(@Param("id") id: string): Promise<Campaign> {
    return this.#campaigns.close(id);
  }
}
