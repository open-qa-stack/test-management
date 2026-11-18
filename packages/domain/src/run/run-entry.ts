/** A step of a run, in the order they run. */
export type Step = "configuration" | "prerequisites" | "cartography" | "design" | "execution" | "summary";

/** An entry of the journal of a run. */
export interface RunEntry {
  /** When it happened, as an ISO 8601 date. */
  readonly at: string;
  readonly step: Step;
  /** `started` and `finished` frame each step; `info` and `error` tell what happened in it. */
  readonly event: "started" | "finished" | "info" | "error";
  readonly message: string;
  /** For `finished`: how long the step took, in milliseconds. */
  readonly durationMs?: number;
  /** For `finished`: how many requests the step sent to the model. */
  readonly modelRequests?: number;
}

/**
 * Writes an entry of the journal as a line a person reads, the same whoever shows it.
 *
 * @param entry - The entry.
 * @returns The line, without its end: the step, what the entry is unless it only informs, the message, then the figures of a step that finished.
 */
export function entryLine(entry: RunEntry): string {
  const figures = [
    entry.durationMs === undefined ? undefined : `${Math.round(entry.durationMs / 100) / 10} s`,
    entry.modelRequests === undefined ? undefined : `${entry.modelRequests} model requests`,
  ].filter((figure) => figure !== undefined);
  return `[${entry.step}] ${entry.event === "info" ? "" : `${entry.event}: `}${entry.message}${figures.length === 0 ? "" : ` (${figures.join(", ")})`}`;
}
