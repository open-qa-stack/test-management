import type { AttemptStatus, ListedTest, ReportedAttempt, ReportedStatus, ReportedTest } from "@open-qa-stack/domain";

/** The part of the JSON of the Playwright reporter the harness reads. */
interface JsonSuite {
  readonly title?: string;
  readonly file?: string;
  readonly specs?: readonly JsonSpec[];
  readonly suites?: readonly JsonSuite[];
}

interface JsonSpec {
  readonly title: string;
  readonly file: string;
  readonly line: number;
  readonly tests: readonly JsonTest[];
}

interface JsonTest {
  readonly projectName: string;
  readonly status: ReportedStatus;
  readonly expectedStatus: AttemptStatus;
  readonly results: readonly JsonResult[];
}

/** One attempt of a test, as the JSON reporter gives it. */
interface JsonResult {
  readonly status: AttemptStatus;
  readonly errors?: readonly { readonly message?: string }[];
  readonly steps?: readonly JsonStep[];
  readonly attachments?: readonly { readonly name: string; readonly path?: string }[];
}

/** One step of an attempt, with the steps it holds. */
interface JsonStep {
  readonly title: string;
  readonly error?: unknown;
  readonly steps?: readonly JsonStep[];
}

/** One test of a report, with what identifies it. */
interface Found {
  readonly id: string;
  readonly test: JsonTest;
}

/**
 * The tests a JSON of the Playwright reporter lists, as `--list --reporter=json` prints it.
 *
 * @param json - The text of the JSON.
 * @returns The tests, in the order of the report; none when the text is not such a report.
 */
export function listedTests(json: string): ListedTest[] | undefined {
  return foundTests(json)?.map(({ id }) => ({ id }));
}

/**
 * The tests a JSON of the Playwright reporter reports after a run.
 *
 * @param json - The text of the JSON.
 * @returns The tests, in the order of the report; none when the text is empty or not such a report.
 */
export function reportedTests(json: string): ReportedTest[] | undefined {
  return foundTests(json)?.map(({ id, test }) => ({
    id,
    status: test.status,
    expectedStatus: test.expectedStatus,
    attempts: test.results.map(attemptOf),
  }));
}

function foundTests(json: string): Found[] | undefined {
  let report: { suites?: unknown };
  try {
    report = JSON.parse(json) as { suites?: unknown };
  } catch {
    return undefined;
  }
  if (report === null || typeof report !== "object" || !Array.isArray(report.suites)) return undefined;
  return (report.suites as JsonSuite[]).flatMap((suite) => walk(suite, []));
}

/** The tests of a suite and of the suites it holds; the titles of a file suite are left out of the identifier. */
function walk(suite: JsonSuite, titles: readonly string[]): Found[] {
  const path = suite.file !== undefined && suite.title === suite.file ? titles : [...titles, suite.title ?? ""];
  const own = (suite.specs ?? []).flatMap((spec) =>
    spec.tests.map((test) => ({ id: [test.projectName, `${spec.file}:${spec.line}`, ...path, spec.title].join(" › "), test })),
  );
  return [...own, ...(suite.suites ?? []).flatMap((child) => walk(child, path))];
}

/** An attempt, with the step that failed, its trace and the context of its error when the report gives them. */
function attemptOf(result: JsonResult): ReportedAttempt {
  const errors = (result.errors ?? []).flatMap((error) => (error.message === undefined ? [] : [error.message]));
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

/** The titles, from the outer to the inner one, of the innermost failed step; a step that failed holds its failed steps. */
function failedStepOf(steps: readonly JsonStep[]): string | undefined {
  const failed = steps.find((step) => step.error !== undefined);
  if (failed === undefined) return undefined;
  const inner = failedStepOf(failed.steps ?? []);
  return inner === undefined ? failed.title : `${failed.title} › ${inner}`;
}
