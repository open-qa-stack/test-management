import { reportEntries } from "../report/json-report.ts";
import type { ReportedStatus } from "../test/reported-test.ts";
import type { ExecutionResult, ExecutionVerdict } from "./execution.ts";

/** The verdict of a test for each status the runner reports it with. */
const VERDICTS: Readonly<Record<ReportedStatus, ExecutionVerdict>> = { expected: "passed", unexpected: "failed", flaky: "flaky", skipped: "skipped" };

/**
 * What came of each test of a report, named as from one execution to the next: by the path of its file in the
 * test repository and by its titles.
 *
 * @param json - The text of the JSON of the Playwright reporter after a run.
 * @param appsDir - The folder of the applications, relative to the test repository, which the runner looks for tests in.
 * @returns The results, in the order of the report, without the digests of their files; `undefined` when the text is not such a report.
 */
export function executionResults(json: string, appsDir: string): Omit<ExecutionResult, "fileDigest">[] | undefined {
  return reportEntries(json)?.map(({ file, title, test }) => ({
    path: `${appsDir}/${file}`,
    title,
    project: test.projectName,
    verdict: VERDICTS[test.status],
    durationMs: test.results.reduce((total, attempt) => total + (attempt.duration ?? 0), 0),
  }));
}
