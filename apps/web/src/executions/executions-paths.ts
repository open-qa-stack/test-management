import type { ExecutionOrigin, ExecutionOutcome } from "@open-qa-stack/domain/sessions";
import { API_BASE } from "../api/api-client.ts";
import { hrefTo } from "../routing/route.ts";
import type { ExecutionPeriod } from "./execution-period.ts";
import type { ExecutionView } from "./execution-view.ts";

/** What a page of the executions is narrowed to: what came of their tests, where they come from, the campaign they were launched for, how far back they go; and how many it holds. */
export interface ExecutionsFilter {
  readonly outcome?: ExecutionOutcome;
  readonly origin?: ExecutionOrigin;
  /** The identifier of a campaign. */
  readonly campaign?: string;
  readonly period?: ExecutionPeriod;
  readonly size?: ExecutionsSize;
}

/** A filter as a person changes it: what they take away is there, and undefined. */
export type ChangedFilter = { readonly [Name in keyof ExecutionsFilter]: ExecutionsFilter[Name] | undefined };

/** How many executions a page may hold, as the address says it; the first is the one it holds by default. */
export const EXECUTIONS_SIZES = ["25", "50", "100"] as const;

/** How many executions a page holds. */
export type ExecutionsSize = (typeof EXECUTIONS_SIZES)[number];

/** Tells whether what an address names is how many executions a page may hold. */
export function isExecutionsSize(value: string | undefined): value is ExecutionsSize {
  return EXECUTIONS_SIZES.some((known) => known === value);
}

/** The address of the screen of the executions. */
export const EXECUTIONS_PATH = "/executions";

/** The address of the screen of the execution that runs. */
export const RUNNING_PATH = `${EXECUTIONS_PATH}/running`;

/** The address of the screen of an execution, whose identifier the query gives. */
export const EXECUTION_PATH = `${EXECUTIONS_PATH}/view`;

/** The address of the screen of what came of a test in an execution, whose identifier and path the query give. */
export const RESULT_PATH = `${EXECUTIONS_PATH}/result`;

/** The address of the screen of the trace of a test in an execution, whose identifier and path the query give. */
export const TRACE_PATH = `${EXECUTIONS_PATH}/trace`;

/** Where the instance serves the trace viewer of Playwright, beside the console. */
export const TRACE_VIEWER = "/trace-viewer/index.html";

/**
 * The link to a page of the executions.
 *
 * @param filter - What the executions are narrowed to; all of them when it names nothing.
 * @param before - The execution the page starts after; the latest ones when none is given.
 * @returns The fragment to put in an `href`.
 */
export function executionsHref({ outcome, origin, campaign, period, size }: ChangedFilter = {}, before?: string): string {
  const query = Object.entries({ outcome, origin, campaign, period, size, before }).filter((entry): entry is [string, string] => entry[1] !== undefined);
  return hrefTo(EXECUTIONS_PATH, Object.fromEntries(query));
}

/**
 * The link to the screen of an execution.
 *
 * @param id - The identifier of the execution.
 * @param view - Which of its tests it shows; those it opens on by default.
 * @param search - The words its tests are narrowed to; none when they are empty.
 * @returns The fragment to put in an `href`.
 */
export function executionHref(id: string, view?: ExecutionView, search = ""): string {
  return hrefTo(EXECUTION_PATH, { id, ...(view === undefined ? {} : { view }), ...(search === "" ? {} : { q: search }) });
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

/**
 * The link to the screen of the trace of a test in an execution.
 *
 * @param id - The identifier of the execution.
 * @param path - The path of the test, relative to the root of the test repository.
 * @returns The fragment to put in an `href`.
 */
export function traceHref(id: string, path: string): string {
  return hrefTo(TRACE_PATH, { id, path });
}

/**
 * The address of the trace viewer of Playwright opened on the trace of a test in an execution, as the instance serves both.
 *
 * @param id - The identifier of the execution.
 * @param path - The path of the test, relative to the root of the test repository.
 * @returns The address, on the origin of the console.
 */
export function traceViewerSrc(id: string, path: string): string {
  const trace = `${API_BASE}/tests/trace?${new URLSearchParams({ path, execution: id }).toString()}`;
  return `${TRACE_VIEWER}?${new URLSearchParams({ trace }).toString()}`;
}
