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
}

/** Why a task was stopped: the limit it reached, and its counters at that moment. */
export interface StopReason {
  /** The limit the task reached. */
  readonly limit: "iterations" | "duration" | "actions";
  /** What the task had used when it stopped. */
  readonly counters: TaskCounters;
}
