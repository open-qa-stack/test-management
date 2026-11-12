import type { ModelChannel } from "./model-channel.ts";
import type { RequestGate } from "./request-gate.ts";

/**
 * What a model runtime needs from the gateway: one channel per session. `ModelGateway` is the
 * implementation.
 */
export interface ModelEndpoint {
  /**
   * Opens a channel for a session.
   *
   * @param gate - Consulted before every request of the channel; `undefined` serves every request.
   * @returns The new channel.
   */
  createChannel(gate: RequestGate | undefined): ModelChannel;
}
