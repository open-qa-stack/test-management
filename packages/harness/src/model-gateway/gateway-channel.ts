import type { GatewayFailure } from "./gateway-failure.ts";
import type { ModelChannel } from "./model-channel.ts";
import type { RequestGate } from "./request-gate.ts";

/** State the gateway keeps for one session: its gate, its request count and its latest failure. */
export class GatewayChannel implements ModelChannel {
  public readonly baseUrl: string;
  public readonly gate: RequestGate | undefined;
  private requests = 0;
  private failure: GatewayFailure | undefined;

  /**
   * @param baseUrl - Address of the channel.
   * @param gate - What decides whether a request is served.
   */
  public constructor(baseUrl: string, gate: RequestGate | undefined) {
    this.baseUrl = baseUrl;
    this.gate = gate;
  }

  /** {@inheritDoc ModelChannel.lastFailure} */
  public get lastFailure(): GatewayFailure | undefined {
    return this.failure;
  }

  /** Requests the channel has served or refused since it opened. */
  public get requestCount(): number {
    return this.requests;
  }

  /** Records that a request arrived; its failure, if any, is recorded by `fail`. */
  public receive(): void {
    this.requests++;
    this.failure = undefined;
  }

  /** @param failure - Why the current request failed. */
  public fail(failure: GatewayFailure): void {
    this.failure = failure;
  }
}
