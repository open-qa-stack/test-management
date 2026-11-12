/** Source of the current time, injectable so that tests control it. */
export interface Clock {
  /** @returns The current time, in milliseconds. */
  now(): number;
}

/** Reads `performance.now()`, which never goes back when the system time is set; the default clock of the runtime. */
export const SYSTEM_CLOCK: Clock = { now: () => performance.now() };
