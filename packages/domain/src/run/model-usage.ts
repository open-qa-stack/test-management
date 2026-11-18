/**
 * The requests a phase or a source sent to the model, the tokens they sent and received when the model
 * reported them, those of the tokens sent that its server read from its cache, once it reported some, and
 * those of the images they sent, as the harness counts them, once one was.
 */
export interface ModelUsage {
  readonly requests: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cachedTokens?: number;
  readonly imageTokens?: number;
}
