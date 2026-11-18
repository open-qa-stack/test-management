/**
 * The name of the inbox of a run, in the folder of the runs of the state folder: the JSON Lines file a
 * person, or an instance for them, appends a message to while the run is going.
 *
 * @param runId - Identifier of the run, such as `oqas-2026-11-13T12-00-00-000Z`.
 * @returns The name of the file, beside the journal of the run.
 */
export function runInboxFile(runId: string): string {
  return `${runId}.inbox.jsonl`;
}
