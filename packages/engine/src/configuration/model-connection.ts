import { checkGitHubAccount, checkProviderModels } from "@open-qa-stack/harness";
import type { Model, ModelConnectionCheck } from "@open-qa-stack/domain";

/** How the connection to each kind of model is checked; those of the harness by default. */
export interface ConnectionProbes {
  /** Who is signed in to GitHub on the machine, and the models Copilot offers them. */
  readonly github: (env: Readonly<Record<string, string | undefined>>) => Promise<ModelConnectionCheck>;
  /** Whether an OpenAI-compatible server takes the key, and the models it lists. */
  readonly provider: (baseUrl: string, apiKey: string | undefined) => Promise<ModelConnectionCheck>;
}

/**
 * The test of the connection to the model a configuration names, before anything is saved: the person sees
 * whether it answers, and chooses the model in what it offers.
 */
export class ModelConnection {
  readonly #env: Readonly<Record<string, string | undefined>>;
  readonly #probes: ConnectionProbes;

  /**
   * @param env - The environment of the process: the key of a provider is read from it, and the GitHub account of
   * the machine is found with it.
   * @param probes - How each connection is checked; those of the harness by default.
   */
  constructor(env: Readonly<Record<string, string | undefined>>, probes: ConnectionProbes = { github: checkGitHubAccount, provider: checkProviderModels }) {
    this.#env = env;
    this.#probes = probes;
  }

  /**
   * Tests a connection to the model.
   *
   * @param model - The connection, as the section `model` of the configuration holds it.
   * @returns What the test found: `key-missing` without asking the server when the variable that holds the key is
   * not set; what the server or the GitHub account answers otherwise.
   */
  check(model: Model): Promise<ModelConnectionCheck> {
    if (model.mode === "github") return this.#probes.github(this.#env);
    if (model.apiKeyEnv === undefined) return this.#probes.provider(model.baseUrl, undefined);
    const key = this.#env[model.apiKeyEnv];
    if (key === undefined || key === "") return Promise.resolve({ state: "key-missing", variable: model.apiKeyEnv });
    return this.#probes.provider(model.baseUrl, key);
  }
}
