/** A model server speaking the OpenAI chat completions API. */
export interface Upstream {
  /** Base URL of the API, for example `http://localhost:1234/v1`. */
  readonly baseUrl: string;
  /** Sent as a bearer token when set. Never written to a recording, a log or an error. */
  readonly apiKey?: string;
  /** Sent as `reasoning_effort` with every request when set, in place of what the model runtime asks for. */
  readonly reasoningEffort?: string;
  /** Longest wait for the answer to one request, in milliseconds; `DEFAULT_UPSTREAM_TIMEOUT_MS` by default. */
  readonly timeoutMs?: number;
}
