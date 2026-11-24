import { Injectable } from "@nestjs/common";

/** The paces of a stream of events, which a client and the proxies before it rely on. */
@Injectable()
export class StreamPace {
  /**
   * How often a stream that has nothing to say sends a comment, in milliseconds: a proxy cuts a connection
   * that stays silent, and a call to a model can last longer than its patience.
   */
  readonly heartbeatMs: number = 15_000;

  /** How long a client waits before it opens a stream that was cut again, in milliseconds. */
  readonly retryMs: number = 3_000;
}
