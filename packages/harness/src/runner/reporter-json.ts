import type { AttemptStatus, ListedTest, ReportedStatus, ReportedTest } from "@open-qa-stack/domain";

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
  readonly results: readonly { readonly status: AttemptStatus; readonly errors?: readonly { readonly message?: string }[] }[];
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
    attempts: test.results.map((result) => ({ status: result.status, errors: (result.errors ?? []).flatMap((error) => (error.message === undefined ? [] : [error.message])) })),
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
