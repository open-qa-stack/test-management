/** Decides whether the gateway may serve the next model request. */
export interface RequestGate {
  /** Records that a model call is about to start; it may stop the task. */
  startIteration(): void;
  /** Whether the task is stopped, in which case no model call is served. */
  readonly stopped: boolean;
}
