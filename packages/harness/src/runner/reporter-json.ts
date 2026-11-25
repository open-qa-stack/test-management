import {
  attemptErrors,
  reportEntries,
  type JsonResult,
  type JsonStep,
  type JsonTest,
  type ListedTest,
  type ReportedAttempt,
  type ReportedTest,
} from "@open-qa-stack/domain";

/**
 * The tests a JSON of the Playwright reporter lists, as `--list --reporter=json` prints it.
 *
 * @param json - The text of the JSON.
 * @returns The tests, in the order of the report; none when the text is not such a report.
 */
export function listedTests(json: string): ListedTest[] | undefined {
  return reportEntries(json)?.map(({ id }) => ({ id }));
}

/**
 * The tests a JSON of the Playwright reporter reports after a run.
 *
 * @param json - The text of the JSON.
 * @returns The tests, in the order of the report; none when the text is empty or not such a report.
 */
export function reportedTests(json: string): ReportedTest[] | undefined {
  return reportEntries(json)?.map(({ id, test }) => ({
    id,
    status: test.status,
    expectedStatus: test.expectedStatus,
    attempts: test.results.map(attemptOf),
    ...skipOf(test),
  }));
}

/** An attempt, with the step that failed, its trace and the context of its error when the report gives them. */
function attemptOf(result: JsonResult): ReportedAttempt {
  const errors = attemptErrors(result).flatMap((error) => (error.message === undefined ? [] : [error.message]));
  const failedStep = failedStepOf(result.steps ?? []);
  const attached = (name: string) => result.attachments?.find((attachment) => attachment.name === name)?.path;
  const trace = attached("trace");
  const errorContext = attached("error-context");
  return {
    status: result.status,
    errors,
    ...(failedStep === undefined ? {} : { failedStep }),
    ...(trace === undefined ? {} : { trace }),
    ...(errorContext === undefined ? {} : { errorContext }),
  };
}

/** Why a test is skipped, when it says so. */
function skipOf({ annotations = [] }: JsonTest): Pick<ReportedTest, "skippedFor"> {
  const said = annotations.find(({ type, description }) => (type === "skip" || type === "fixme") && description !== undefined && description.trim() !== "");
  return said === undefined ? {} : { skippedFor: said.description!.trim() };
}

/** The titles, from the outer to the inner one, of the innermost failed step; a step that failed holds its failed steps. */
function failedStepOf(steps: readonly JsonStep[]): string | undefined {
  const failed = steps.find((step) => step.error !== undefined);
  if (failed === undefined) return undefined;
  const inner = failedStepOf(failed.steps ?? []);
  return inner === undefined ? failed.title : `${failed.title} › ${inner}`;
}
