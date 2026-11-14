/** Limits of a task; `null` leaves a limit unbounded. */
export interface TaskLimits {
  /** Model calls the task may make. */
  readonly maxIterations: number | null;
  /** Time the task may run, from its start, in milliseconds. */
  readonly maxDurationMs: number | null;
  /** Browser actions the agent may take. */
  readonly maxActions: number | null;
}

/** What a task has used so far. */
export interface TaskCounters {
  /** Model calls served. */
  readonly iterations: number;
  /** Browser actions that ran. */
  readonly actions: number;
  /** Time since the task started, in milliseconds. */
  readonly elapsedMs: number;
  /** Tokens sent to the model, when it reported them. */
  readonly inputTokens?: number;
  /** Tokens the model produced, when it reported them. */
  readonly outputTokens?: number;
  /** Those of `inputTokens` the model server read from its cache, once it reported some: a server bills them less. */
  readonly cachedTokens?: number;
  /**
   * Tokens of the images sent to the model, once one was: the harness counts each image in each call that
   * carries it, at `imageTokens`, since models leave them out of the tokens they report.
   */
  readonly imageTokens?: number;
}

/** Why a task was stopped: the limit it reached, and its counters at that moment. */
export interface StopReason {
  /** The limit the task reached. */
  readonly limit: "iterations" | "duration" | "actions";
  /** What the task had used when it stopped. */
  readonly counters: TaskCounters;
}
