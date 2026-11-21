import { checkGitHubAccount, checkProviderModels } from "@open-qa-stack/harness";
import type { Model, ModelConnectionCheck } from "@open-qa-stack/domain";
import { environmentOf } from "../secrets/environment-of.ts";
import type { Environment, EnvironmentSource } from "../ports/environment-source.ts";

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
  readonly #env: Environment | EnvironmentSource;
  readonly #probes: ConnectionProbes;

  /**
   * @param env - The environment of the process, or what reads it as it is at each test: the key of a provider is
   * read from it, and the GitHub account of the machine is found with it.
   * @param probes - How each connection is checked; those of the harness by default.
   */
  constructor(env: Environment | EnvironmentSource, probes: ConnectionProbes = { github: checkGitHubAccount, provider: checkProviderModels }) {
    this.#env = env;
    this.#probes = probes;
  }

  /**
   * Tests a connection to the model.
   *
   * @param model - The connection, as the section `model` of the configuration holds it.
   * @param typed - The key the person typed, and has not saved yet; that of the variable the connection names otherwise.
   * @returns What the test found: `key-missing` without asking the server when there is no key, neither typed nor in
   * the variable; what the server or the GitHub account answers otherwise.
   */
  async check(model: Model, typed?: string): Promise<ModelConnectionCheck> {
    const env = await environmentOf(this.#env);
    if (model.mode === "github") return this.#probes.github(env);
    if (model.apiKeyEnv === undefined) return this.#probes.provider(model.baseUrl, typed || undefined);
    const key = typed || env[model.apiKeyEnv];
    if (key === undefined || key === "") return { state: "key-missing", variable: model.apiKeyEnv };
    return this.#probes.provider(model.baseUrl, key);
  }
}
