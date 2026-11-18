import { ExitCode, type ExitCodeValue, type Verdict } from "@open-qa-stack/domain";

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
