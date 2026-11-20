import type { Campaign, CampaignTest } from "./campaign.ts";

/** The port of the store of the campaigns: what the operations on campaigns ask of what keeps them, whatever keeps them. */
export interface CampaignStorePort {
  /** Keeps a campaign that was just planned, under an identifier no other one has. */
  add(campaign: Campaign): Promise<void>;

  /** @returns The campaign of an identifier with its tests; `undefined` when it keeps none under it. */
  get(id: string): Promise<Campaign | undefined>;

  /** @returns Every campaign, the latest planned first, each with its tests. */
  list(): Promise<Campaign[]>;

  /**
   * Fixes the tests of a planned campaign, which becomes ready.
   *
   * @param id - The identifier of the campaign.
   * @param tests - Its tests.
   * @param at - When, as an ISO 8601 date.
   */
  ready(id: string, tests: readonly CampaignTest[], at: string): Promise<void>;

  /**
   * Changes the state of a campaign: to `in_progress`, or to `closed` with when.
   *
   * @param id - The identifier of the campaign.
   * @param status - Its new state.
   * @param at - When it was closed, as an ISO 8601 date, for `closed`.
   */
  move(id: string, status: "in_progress" | "closed", at?: string): Promise<void>;
}
