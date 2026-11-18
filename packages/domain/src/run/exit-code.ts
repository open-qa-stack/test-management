/** The codes a run ends with, which a command line that hosts the engine exits with and the state of the run keeps. */
export const ExitCode = {
  /** The whole chain ran, and every test passed. */
  passed: 0,
  /** The whole chain ran, and a test failed. */
  failed: 1,
  /** The whole chain ran without a failure, but a test was blocked, indeterminate, skipped or not run, or the design left a scenario of its plan without a test. */
  unsettled: 2,
  /** The configuration is missing or invalid, or the run was asked what it cannot do. */
  configuration: 3,
  /** A prerequisite of the machine is missing. */
  prerequisite: 4,
  /** The chain did not go to its end: a step stopped on an error or for want of a test, or the state could not be written. */
  interrupted: 5,
} as const;

/** One of the codes a run ends with. */
export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];
