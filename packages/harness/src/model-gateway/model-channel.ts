import type { GatewayFailure } from "./gateway-failure.ts";

/** The part of the gateway one session talks to: its own address, and what it saw when a request failed. */
export interface ModelChannel {
  /** Base URL of the chat completions API, for this session only. */
  readonly baseUrl: string;
  /** Why the latest request of this session failed, or `undefined` if it succeeded. */
  readonly lastFailure: GatewayFailure | undefined;
}
