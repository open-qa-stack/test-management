/** Folder of the runs of the tests, in the state folder of the test repository: the result and the report of each. */
export const RUNS_FOLDER = "runs";

/** Folder of the traces, in the state folder of the test repository. */
export const TRACES_FOLDER = "traces";

/** What opens the identifier of a run, before the date it started. */
const RUN_PREFIX = "oqas-";

/**
 * Writes a date as the name of a file bears it: names written this way sort in time.
 *
 * @param date - The date.
 * @returns The date in ISO 8601, in UTC, its colons and its dot written `-`.
 */
function fileStamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

/**
 * Names a run.
 *
 * @param started - When the run started.
 * @returns Its identifier, such as `oqas-2026-11-13T12-00-00-000Z`.
 */
export function runIdAt(started: Date): string {
  return `${RUN_PREFIX}${fileStamp(started)}`;
}

/**
 * The name of a trace, in the folder of the traces: a JSON Lines file, named after what it traces and the date
 * it started.
 *
 * @param name - What the trace is of, as `cartography-local`.
 * @param started - When it started.
 * @returns The name of the file.
 */
export function traceFile(name: string, started: Date): string {
  return `${name}-${fileStamp(started)}.jsonl`;
}
