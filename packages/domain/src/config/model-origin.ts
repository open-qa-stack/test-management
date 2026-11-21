import type { Model } from "./types.ts";

/** The address a model of GitHub Copilot is said to come from, in what a run keeps of its model. */
export const GITHUB_COPILOT_URL = "https://api.githubcopilot.com";

/** Which model produced something, as a run keeps it: who serves it, where, and its name. */
export interface ModelOrigin {
  readonly provider: string;
  readonly baseUrl: string;
  readonly model: string;
}

/**
 * Which model a run uses, as the cards, the indexes and the designs keep it.
 *
 * @param model - The connection to the model.
 * @returns Its provider, address and name; a model of GitHub Copilot is served by `github`, at its address.
 */
export function modelOrigin(model: Model): ModelOrigin {
  if (model.mode === "github") return { provider: "github", baseUrl: GITHUB_COPILOT_URL, model: model.model };
  return { provider: model.provider, baseUrl: model.baseUrl, model: model.model };
}
