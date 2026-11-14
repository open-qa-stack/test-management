/** Why the gateway could not answer a request. */
export type GatewayFailure =
  /** The upstream server did not answer at `url`. */
  | { readonly kind: "unreachable"; readonly url: string }
  /** The upstream server answered with an error status, and `reason` when its answer said why. */
  | { readonly kind: "upstream-status"; readonly status: number; readonly reason?: string }
  /** The upstream server answered with a body that is not JSON. */
  | { readonly kind: "invalid-response" }
  /** The recording has no exchange for the request `request` describes. */
  | { readonly kind: "replay-miss"; readonly request: string }
  /** The model runtime sent a request that is not a readable chat completion request. */
  | { readonly kind: "invalid-request" }
  /** The task was stopped by a limit, so no model call is served. */
  | { readonly kind: "task-stopped" }
  /** The model runtime called something other than chat completions. */
  | { readonly kind: "unsupported"; readonly path: string };
