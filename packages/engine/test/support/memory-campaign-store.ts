import type { Campaign, CampaignStorePort, CampaignTest } from "@open-qa-stack/domain";

/** The campaigns, kept in memory as the database keeps them. */
export class MemoryCampaignStore implements CampaignStorePort {
  readonly #campaigns: Campaign[] = [];

  add(campaign: Campaign): Promise<void> {
    this.#campaigns.push(campaign);
    return Promise.resolve();
  }

  get(id: string): Promise<Campaign | undefined> {
    return Promise.resolve(this.#campaigns.find((campaign) => campaign.id === id));
  }

  list(): Promise<Campaign[]> {
    return Promise.resolve(this.#campaigns.toReversed());
  }

  choose(id: string, tests: readonly CampaignTest[]): Promise<void> {
    this.#change(id, (campaign) => ({ ...campaign, tests }));
    return Promise.resolve();
  }

  ready(id: string, at: string): Promise<void> {
    this.#change(id, (campaign) => ({ ...campaign, status: "ready", readyAt: at }));
    return Promise.resolve();
  }

  move(id: string, status: "in_progress" | "closed", at?: string): Promise<void> {
    this.#change(id, (campaign) => ({ ...campaign, status, ...(at === undefined ? {} : { closedAt: at }) }));
    return Promise.resolve();
  }

  #change(id: string, change: (campaign: Campaign) => Campaign): void {
    const index = this.#campaigns.findIndex((campaign) => campaign.id === id);
    this.#campaigns[index] = change(this.#campaigns[index]!);
  }
}
