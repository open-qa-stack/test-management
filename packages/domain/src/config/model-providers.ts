/** A provider of models the console offers by name: its OpenAI-compatible API, and the variable its key is usually kept in. */
export interface ModelProvider {
  /** How the provider is named in the list. */
  readonly name: string;
  /** The address of its OpenAI-compatible API. */
  readonly baseUrl: string;
  /** The variable the key is read from unless the person names another. */
  readonly apiKeyEnv: string;
}

/**
 * The providers offered by name, in the order they are listed. Any other server is reached by its address:
 * a model served on the machine, a provider of a company, or one this list does not name.
 */
export const MODEL_PROVIDERS: readonly ModelProvider[] = [
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY" },
  { name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", apiKeyEnv: "ANTHROPIC_API_KEY" },
  { name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKeyEnv: "GEMINI_API_KEY" },
  { name: "Mistral AI", baseUrl: "https://api.mistral.ai/v1", apiKeyEnv: "MISTRAL_API_KEY" },
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY" },
];

/**
 * The provider a server address belongs to, whether or not it ends with a slash.
 *
 * @param baseUrl - The address of the server.
 * @returns The provider of the list with this address, or `undefined` for any other server.
 */
export function providerOf(baseUrl: string): ModelProvider | undefined {
  const bare = baseUrl.replace(/\/+$/, "");
  return MODEL_PROVIDERS.find((provider) => provider.baseUrl === bare);
}
