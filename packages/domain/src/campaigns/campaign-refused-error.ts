/**
 * A change a campaign cannot take: one its state does not allow — it goes from planned to ready, then in_progress,
 * then closed — or a scope that takes no test of the repository. Its message says which, and what to do.
 */
export class CampaignRefusedError extends Error {
  /** @param message - Why, and what to do. */
  constructor(message: string) {
    super(message);
    this.name = "CampaignRefusedError";
  }
}
