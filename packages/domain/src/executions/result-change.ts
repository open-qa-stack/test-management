import type { ExecutionResult } from "./execution.ts";

/**
 * What an execution changed for a test since the last one before it that ran the test: `new_failure` when it failed
 * and did not before, `still_failing` when it failed and did already, `fixed` when it passed, at once or on a retry,
 * and failed before.
 */
export type ResultChange = "new_failure" | "still_failing" | "fixed";

/**
 * Compares what came of a test in an execution with what came of it before.
 *
 * @param result - What came of it, with what came of it before when the instance told it.
 * @returns What changed; `undefined` when nothing did, when the test did not run, or when none ran it before.
 */
export function resultChange({ verdict, previous }: Pick<ExecutionResult, "verdict" | "previous">): ResultChange | undefined {
  if (verdict === "skipped" || previous === undefined) return undefined;
  if (verdict === "failed") return previous === "failed" ? "still_failing" : "new_failure";
  return previous === "failed" ? "fixed" : undefined;
}
