import type { ExecutionOutcome } from "@open-qa-stack/domain/sessions";
import { hrefTo } from "../routing/route.ts";
import type { ExecutionPeriod } from "./execution-period.ts";

/** What a page of the executions is narrowed to: what came of their tests, how far back they go. */
export interface ExecutionsFilter {
  readonly outcome?: ExecutionOutcome;
  readonly period?: ExecutionPeriod;
}

/** The address of the screen of the executions. */
export const EXECUTIONS_PATH = "/executions";

/** The address of the screen of an execution, whose identifier the query gives. */
export const EXECUTION_PATH = `${EXECUTIONS_PATH}/view`;

/** The address of the screen of what came of a test in an execution, whose identifier and path the query give. */
export const RESULT_PATH = `${EXECUTIONS_PATH}/result`;

/**
 * The link to a page of the executions.
 *
 * @param filter - What the executions are narrowed to; all of them when it names nothing.
 * @param before - The execution the page starts after; the latest ones when none is given.
 * @returns The fragment to put in an `href`.
 */
export function executionsHref({ outcome, period }: ExecutionsFilter = {}, before?: string): string {
  return hrefTo(EXECUTIONS_PATH, {
    ...(outcome === undefined ? {} : { outcome }),
    ...(period === undefined ? {} : { period }),
    ...(before === undefined ? {} : { before }),
  });
}

/**
 * The link to the screen of an execution.
 *
 * @param id - The identifier of the execution.
 * @returns The fragment to put in an `href`.
 */
export function executionHref(id: string): string {
  return hrefTo(EXECUTION_PATH, { id });
}

/**
 * The link to the screen of what came of a test in an execution, showing the page at one of its steps when one is given.
 *
 * @param id - The identifier of the execution.
 * @param path - The path of the test, relative to the root of the test repository.
 * @param step - The number of the step, from 1.
 * @returns The fragment to put in an `href`.
 */
export function resultHref(id: string, path: string, step?: number): string {
  return hrefTo(RESULT_PATH, { id, path, ...(step === undefined ? {} : { step: String(step) }) });
}
