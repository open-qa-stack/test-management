/** A campaign asked for that the instance does not keep. */
export class UnknownCampaignError extends Error {
  /** @param id - The identifier asked for. */
  constructor(id: string) {
    super(`The instance keeps no campaign ${id}.`);
    this.name = "UnknownCampaignError";
  }
}
