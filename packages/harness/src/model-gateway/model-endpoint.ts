import type { GatewayFailure } from "./gateway-failure.ts";

/**
 * What a model runtime needs from the gateway: where to send requests, and why the latest one failed.
 * `ModelGateway` is the implementation.
 */
export interface ModelEndpoint {
  /** Base URL of the chat completions API. */
  readonly baseUrl: string;
  /** Why the latest request failed, or `undefined` if it succeeded. */
  readonly lastFailure: GatewayFailure | undefined;
}
