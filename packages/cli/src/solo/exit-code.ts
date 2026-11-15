import type { Verdict } from "@open-qa-stack/domain";

/** The exit codes of the solo command. */
export const ExitCode = {
  /** The whole chain ran, and every test passed. */
  passed: 0,
  /** The whole chain ran, and a test failed. */
  failed: 1,
  /** The whole chain ran without a failure, but a test was blocked, indeterminate, skipped or not run, or the design left a scenario of its plan without a test. */
  unsettled: 2,
  /** The configuration is missing or invalid, or the command was misused. */
  configuration: 3,
  /** A prerequisite of the machine is missing. */
  prerequisite: 4,
  /** The chain did not go to its end: a step stopped on an error or for want of a test, or the state could not be written. */
  interrupted: 5,
} as const;

/** One of the exit codes of the solo command. */
export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * The exit code of a run that went to its end, from the verdicts of its tests.
 *
 * @param verdicts - The verdict of each test.
 * @returns `passed` when each passed, `failed` when one failed, `unsettled` otherwise.
 */
export function exitCodeOf(verdicts: readonly Verdict[]): ExitCodeValue {
  if (verdicts.includes("failed")) return ExitCode.failed;
  return verdicts.length > 0 && verdicts.every((verdict) => verdict === "passed") ? ExitCode.passed : ExitCode.unsettled;
}
