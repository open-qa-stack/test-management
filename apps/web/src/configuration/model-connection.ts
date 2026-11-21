import { MODEL_PROVIDERS, providerOf, type Model, type ModelChoice, type ModelConnectionCheck } from "@open-qa-stack/domain/sessions";

/** The choice of the GitHub account of the machine, in the list of the connections. */
export const GITHUB_CHOICE = "github";

/** The choice of a server the list does not name, reached by its address. */
export const OTHER_CHOICE = "other";

/**
 * How a connection to the model is chosen in the list.
 *
 * @param model - The section `model` of the draft.
 * @returns `github`, the name of the provider its address belongs to, or `other`.
 */
export function connectionOf(model: Model): string {
  if (model.mode === "github") return GITHUB_CHOICE;
  return providerOf(model.baseUrl)?.name ?? OTHER_CHOICE;
}

/**
 * The connection to the model once the person chose how to reach it. The model is chosen again, since each
 * connection names its own: the field stays empty until the person picks one.
 *
 * @param choice - `github`, the name of a provider of the list, or `other`.
 * @param model - The connection before the choice.
 * @returns The new section `model`: that of the GitHub account; that of the provider, with its address and the
 * variable its key is usually kept in; or that of another server, which keeps the address of the one before
 * when it was already another server.
 */
export function modelFor(choice: string, model: Model): Model {
  if (choice === GITHUB_CHOICE) return { mode: "github", model: "" };
  const provider = MODEL_PROVIDERS.find(({ name }) => name === choice);
  if (provider !== undefined) return { mode: "provider-key", provider: "openai", baseUrl: provider.baseUrl, model: "", apiKeyEnv: provider.apiKeyEnv };
  const kept = model.mode === "provider-key" && providerOf(model.baseUrl) === undefined ? model.baseUrl : "";
  return { mode: "provider-key", provider: "openai", baseUrl: kept, model: "" };
}

/**
 * Tells whether a test of the connection still holds for the draft: it does as long as the model is reached the
 * same way, whichever model is chosen in what it offered.
 *
 * @param tested - The section `model` when the test was asked for.
 * @param model - The section `model` of the draft now.
 * @returns Whether both reach the model through the same account, or the same address with the same key.
 */
export function sameReach(tested: Model, model: Model): boolean {
  if (tested.mode === "github" || model.mode === "github") return tested.mode === model.mode;
  return tested.baseUrl === model.baseUrl && tested.apiKeyEnv === model.apiKeyEnv;
}

/**
 * The models a test found, with the one the draft names when the list does not hold it, so that the choice of the
 * person is never lost.
 *
 * @param check - What the test found.
 * @param chosen - The model the draft names; empty when none is chosen yet.
 * @returns The models to choose from, or `undefined` when the connection gives no list: the person types the name.
 */
export function modelChoices(check: ModelConnectionCheck | undefined, chosen: string): readonly ModelChoice[] | undefined {
  if (check?.state !== "connected" || check.models === undefined) return undefined;
  if (chosen === "" || check.models.some(({ id }) => id === chosen)) return check.models;
  return [{ id: chosen, name: chosen, reasoningEfforts: [] }, ...check.models];
}
