import type { ExecutionVerdict } from "../executions/execution.ts";

/**
 * Where a campaign is in its life: `planned` while its scope may still change, `ready` once its tests are fixed,
 * `in_progress` from its first launch, `closed` for good.
 */
export type CampaignStatus = "planned" | "ready" | "in_progress" | "closed";

/** Which tests of the repository a campaign takes: those that bear at least one of its tags, or every test when it names none. */
export interface CampaignScope {
  readonly tags: readonly string[];
}

/** A test a campaign fixed when it became ready, named as the tests of the repository are. */
export interface CampaignTest {
  /** The path of its file, relative to the root of the test repository. */
  readonly path: string;
  readonly title: string;
}

/** What a campaign is asked to be when it is planned. */
export interface CampaignPlan {
  readonly name: string;
  /** The environment its tests run against. */
  readonly environment: string;
  readonly scope: CampaignScope;
}

/** A campaign of tests: a scope of the repository, fixed once ready, run against one environment until it is closed. */
export interface Campaign extends CampaignPlan {
  readonly id: string;
  readonly status: CampaignStatus;
  /** When it was planned, as an ISO 8601 date. */
  readonly createdAt: string;
  /** When its tests were fixed, as an ISO 8601 date; left out while it is planned. */
  readonly readyAt?: string;
  /** When it was closed, as an ISO 8601 date; left out until then. */
  readonly closedAt?: string;
  /** The tests it fixed when it became ready, in the order of their paths; none while it is planned. */
  readonly tests: readonly CampaignTest[];
}

/** The campaigns of the instance, the latest planned first, as `GET /campaigns` answers. */
export interface CampaignList {
  readonly items: readonly Campaign[];
}

/** What came of a test of a campaign: its verdict in the latest execution of the campaign that ran it, or `not_run`. */
export interface CampaignResult extends CampaignTest {
  readonly verdict: ExecutionVerdict | "not_run";
  /** The execution that gave the verdict; left out for a test no execution of the campaign ran. */
  readonly execution?: string;
  /** When that execution was kept, as an ISO 8601 date. */
  readonly ranAt?: string;
}

/** A campaign with what came of each of its tests, as `GET /campaigns/:id` answers. */
export interface CampaignProgress {
  readonly campaign: Campaign;
  readonly results: readonly CampaignResult[];
}
