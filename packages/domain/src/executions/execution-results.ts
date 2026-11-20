import { reportEntries, type JsonTest } from "../report/json-report.ts";
import { attemptFailure } from "../report/qa-view.ts";
import type { ReportedStatus } from "../test/reported-test.ts";
import type { ExecutionFailure, ExecutionResult, ExecutionVerdict } from "./execution.ts";

/** The verdict of a test for each status the runner reports it with. */
const VERDICTS: Readonly<Record<ReportedStatus, ExecutionVerdict>> = { expected: "passed", unexpected: "failed", flaky: "flaky", skipped: "skipped" };

/**
 * What came of each test of a report, named as from one execution to the next: by the path of its file in the
 * test repository and by its titles.
 *
 * @param json - The text of the JSON of the Playwright reporter after a run.
 * @param appsDir - The folder of the applications, relative to the test repository, which the runner looks for tests in.
 * @returns The results, in the order of the report, with where each test that failed failed, without the digests of their files; `undefined` when the text is not such a report.
 */
export function executionResults(json: string, appsDir: string): Omit<ExecutionResult, "fileDigest">[] | undefined {
  return reportEntries(json)?.map(({ file, title, test }) => {
    const verdict = VERDICTS[test.status];
    const failure = verdict === "failed" ? failureOf(test) : undefined;
    return {
      path: `${appsDir}/${file}`,
      title,
      project: test.projectName,
      verdict,
      durationMs: test.results.reduce((total, attempt) => total + (attempt.duration ?? 0), 0),
      ...(failure === undefined ? {} : { failure }),
    };
  });
}

/**
 * Where a test failed and why, from its last attempt: its step that failed, the first line of its error, what it
 * expected and received; `undefined` when the report says none of it.
 */
function failureOf(test: JsonTest): ExecutionFailure | undefined {
  const last = test.results.at(-1);
  const { failedStep, message, expected, received } = attemptFailure(last);
  const firstLine = message
    ?.split("\n")
    .find((line) => line.trim() !== "")
    ?.trim();
  const failure: ExecutionFailure = {
    ...(failedStep === undefined ? {} : { step: { number: failedStep, title: last!.steps![failedStep - 1]!.title } }),
    ...(firstLine === undefined ? {} : { message: firstLine }),
    ...(expected === undefined ? {} : { expected, received: received! }),
  };
  return Object.keys(failure).length === 0 ? undefined : failure;
}
