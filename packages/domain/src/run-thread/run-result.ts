import { isRecord } from "../json.ts";
import { ExitCode } from "../run/exit-code.ts";
import type { SessionResult, SessionTest, TestVerdict } from "../sessions/session.ts";

/** How a run ended, by the code it ended with; any other code is a run that did not go to its end. */
const OUTCOMES: ReadonlyMap<unknown, SessionResult["outcome"]> = new Map([
  [ExitCode.passed, "passed"],
  [ExitCode.failed, "failed"],
  [ExitCode.unsettled, "inconclusive"],
]);

/** The verdicts a client knows. */
const VERDICTS = ["passed", "failed", "blocked", "indeterminate", "skipped", "not_run"] as const satisfies readonly TestVerdict[];

/** The verdicts a state lists, those that are whole; a verdict a client does not know is read as no verdict of success or failure. */
function testsOf(tests: unknown): SessionTest[] {
  if (!Array.isArray(tests)) return [];
  return tests.flatMap((test: unknown) => {
    if (!isRecord(test)) return [];
    const { id, verdict, reason } = test;
    if (typeof id !== "string" || typeof reason !== "string") return [];
    return [{ id, verdict: VERDICTS.find((known) => known === verdict) ?? "indeterminate", reason }];
  });
}

/**
 * Reads what a run came to from the state it wrote when it ended, as the result of its session.
 *
 * @remarks
 * The state is read from a file anyone may have written to: what it does not hold, or holds in another form,
 * is left out or counted as nothing, and never refused.
 *
 * @param ended - The state of the run, as its file holds it.
 * @returns The result: how the run ended, by its exit code, how long it took, the requests to the model summed
 * over its steps, the branch of its tests when it names one, and the verdict of each test.
 */
export function sessionResultOf(ended: Readonly<Record<string, unknown>>): SessionResult {
  const { exitCode, durationMs, steps, branch, tests } = ended;
  const requests = Array.isArray(steps) ? steps.map((step: unknown) => (isRecord(step) ? step["modelRequests"] : undefined)) : [];
  return {
    outcome: OUTCOMES.get(exitCode) ?? "stopped",
    durationMs: typeof durationMs === "number" ? durationMs : 0,
    modelRequests: requests.reduce<number>((total, count) => total + (typeof count === "number" ? count : 0), 0),
    ...(typeof branch === "string" ? { branch } : {}),
    tests: testsOf(tests),
  };
}
