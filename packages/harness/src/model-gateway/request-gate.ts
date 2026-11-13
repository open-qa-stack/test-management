/** Decides whether the gateway may serve the next model request. */
export interface RequestGate {
  /** Records that a model call is about to start; it may stop the task. */
  startIteration(): void;
  /** Whether the task is stopped, in which case no model call is served. */
  readonly stopped: boolean;
  /**
   * Records the tokens a model call used, when the model reported them.
   *
   * @param input - Tokens sent to the model.
   * @param output - Tokens the model produced.
   */
  countTokens?(input: number, output: number): void;
}
