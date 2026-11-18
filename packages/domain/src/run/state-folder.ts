/** Folder of the runs, in the state folder of the test repository: the journal, the state and the inbox of each. */
export const RUNS_FOLDER = "runs";

/** Folder of the traces, in the state folder of the test repository. */
export const TRACES_FOLDER = "traces";

/** What opens the identifier of a run, before the date it started. */
const RUN_PREFIX = "oqas-";

/** A date as the name of a file writes it, such as `2026-11-13T12-00-00-000Z`. */
const STAMP = String.raw`\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z`;

const JOURNAL = new RegExp(String.raw`^(${RUN_PREFIX}${STAMP})\.jsonl$`);

const TRACE = new RegExp(String.raw`-(${STAMP})\.jsonl$`);

/**
 * Writes a date as the name of a file bears it: names written this way sort in time.
 *
 * @param date - The date.
 * @returns The date in ISO 8601, in UTC, its colons and its dot written `-`.
 */
export function fileStamp(date: Date): string {
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
 * @param runId - Identifier of a run.
 * @returns The date it started, as the name of a trace writes it.
 */
export function runStamp(runId: string): string {
  return runId.slice(RUN_PREFIX.length);
}

/**
 * @param runId - Identifier of a run.
 * @returns The date it started, as an ISO 8601 date.
 */
export function runStartedAt(runId: string): string {
  return runStamp(runId).replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z");
}

/**
 * The name of the journal of a run, in the folder of the runs: a JSON Lines file, an entry a line, which
 * exists from the start of the run on.
 *
 * @param runId - Identifier of the run.
 * @returns The name of the file.
 */
export function runJournalFile(runId: string): string {
  return `${runId}.jsonl`;
}

/**
 * The name of the state of a run, in the folder of the runs: a JSON file, written when the run ends.
 *
 * @param runId - Identifier of the run.
 * @returns The name of the file, beside the journal of the run.
 */
export function runStateFile(runId: string): string {
  return `${runId}.json`;
}

/**
 * The name of the inbox of a run, in the folder of the runs: the JSON Lines file a person, or an instance for
 * them, appends a message to while the run is going.
 *
 * @param runId - Identifier of the run, such as `oqas-2026-11-13T12-00-00-000Z`.
 * @returns The name of the file, beside the journal of the run.
 */
export function runInboxFile(runId: string): string {
  return `${runId}.inbox.jsonl`;
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

/**
 * Reads the name of a file of the folder of the runs as that of a journal.
 *
 * @param fileName - The name of a file.
 * @returns The identifier of the run it is the journal of; `undefined` for any other file, the state and the inbox of a run included.
 */
export function journaledRun(fileName: string): string | undefined {
  return JOURNAL.exec(fileName)?.[1];
}

/**
 * Reads the name of a file of the folder of the traces.
 *
 * @param fileName - The name of a file.
 * @returns The date the trace started, written as in the identifier of a run, which tells the run it belongs to;
 * `undefined` for a file that is no trace.
 */
export function traceStamp(fileName: string): string | undefined {
  return TRACE.exec(fileName)?.[1];
}
