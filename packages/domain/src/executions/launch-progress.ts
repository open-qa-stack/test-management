import { isRecord } from "../json.ts";
import type { ExecutionVerdict } from "./execution.ts";
import type { FinishedTest, LaunchProgress } from "./test-launch.ts";

/** The verdicts a line of progress may tell. */
const VERDICTS: readonly ExecutionVerdict[] = ["passed", "failed", "flaky", "skipped"];

/**
 * Reads the progress a launch wrote while its tests ran: one JSON line when the runner listed them, `{ "total": n }`,
 * then one each test it finished, `{ "path", "title", "verdict" }`.
 *
 * @remarks
 * Pure. A line that is not one of those — the last one, still being written, among others — is passed over: the
 * progress is read again a moment later.
 *
 * @param text - The file of the progress, as it is now; empty before the runner started.
 * @returns How far the launch went.
 */
export function launchProgress(text: string): LaunchProgress {
  let total: number | undefined;
  const finished: FinishedTest[] = [];
  for (const line of text.split("\n")) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(value)) continue;
    const { path, title, verdict } = value;
    if (typeof value["total"] === "number") total = value["total"];
    else if (typeof path === "string" && typeof title === "string" && VERDICTS.includes(verdict as ExecutionVerdict))
      finished.push({ path, title, verdict: verdict as ExecutionVerdict });
  }
  return { ...(total === undefined ? {} : { total }), finished };
}
