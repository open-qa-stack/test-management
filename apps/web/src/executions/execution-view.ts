import { resultChange, type ExecutionResult } from "@open-qa-stack/domain/sessions";

/**
 * Which tests of an execution its screen shows: those to look at — the failures, and the tests fixed —, every one, the
 * new failures, the tests fixed, or those that passed only on a retry.
 */
export type ExecutionView = "attention" | "all" | "new_failures" | "fixed" | "flaky";

/** The tests each view shows, in the order a person chooses among them. */
const SHOWN: Readonly<Record<ExecutionView, (result: ExecutionResult) => boolean>> = {
  attention: (result) => result.verdict === "failed" || resultChange(result) === "fixed",
  all: () => true,
  new_failures: (result) => resultChange(result) === "new_failure",
  fixed: (result) => resultChange(result) === "fixed",
  flaky: ({ verdict }) => verdict === "flaky",
};

/** The views, in the order a person chooses among them. */
export const EXECUTION_VIEWS = Object.keys(SHOWN) as readonly ExecutionView[];

/** Tells whether what an address names is a view. */
export function isExecutionView(value: string | undefined): value is ExecutionView {
  return value !== undefined && Object.hasOwn(SHOWN, value);
}

/**
 * The tests of an execution a view shows.
 *
 * @param results - The tests, in the order of the report.
 * @param view - The view.
 * @returns Those it shows, in the same order.
 */
export function shownIn(results: readonly ExecutionResult[], view: ExecutionView): readonly ExecutionResult[] {
  return results.filter(SHOWN[view]);
}

/**
 * The view an execution opens on.
 *
 * @param results - Its tests.
 * @returns Those to look at; every test when there is none to.
 */
export function openingView(results: readonly ExecutionResult[]): ExecutionView {
  return shownIn(results, "attention").length > 0 ? "attention" : "all";
}
