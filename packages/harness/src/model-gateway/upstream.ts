/** A model server speaking the OpenAI chat completions API. */
export interface Upstream {
  /** Base URL of the API, for example `http://localhost:1234/v1`. */
  readonly baseUrl: string;
  /** Sent as a bearer token when set. Never written to a recording, a log or an error. */
  readonly apiKey?: string;
  /** Sent as `reasoning_effort` with every request when set, in place of what the model runtime asks for. */
  readonly reasoningEffort?: string;
}
