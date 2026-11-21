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
   * Replaces the tests chosen for a planned campaign.
   *
   * @param id - The identifier of the campaign.
   * @param tests - Its tests, each once.
   */
  choose(id: string, tests: readonly CampaignTest[]): Promise<void>;

  /**
   * Fixes the tests of a planned campaign, which becomes ready.
   *
   * @param id - The identifier of the campaign.
   * @param at - When, as an ISO 8601 date.
   */
  ready(id: string, at: string): Promise<void>;

  /**
   * Changes the state of a campaign from the one it is in: to `in_progress`, or to `closed` with when. Of two changes
   * from one state at once, one only is made.
   *
   * @param id - The identifier of the campaign.
   * @param from - The state it must be in for the change to be made.
   * @param status - Its new state.
   * @param at - When it was closed, as an ISO 8601 date, for `closed`.
   * @returns Whether the change was made: `false` when the campaign was no longer in `from`.
   */
  move(id: string, from: "ready" | "in_progress", status: "in_progress" | "closed", at?: string): Promise<boolean>;
}
