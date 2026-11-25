import type { AttemptStatus, ReportedStatus } from "../test/reported-test.ts";

/** A suite of the JSON of the Playwright reporter: a file, a `describe`, or the root of a project. */
export interface JsonSuite {
  readonly title?: string;
  readonly file?: string;
  readonly specs?: readonly JsonSpec[];
  readonly suites?: readonly JsonSuite[];
}

/** A `test(…)` of a file, with each test of it in each project. */
export interface JsonSpec {
  readonly title: string;
  readonly file: string;
  readonly line: number;
  readonly tests: readonly JsonTest[];
}

/** A test in one project, with each of its attempts. */
export interface JsonTest {
  readonly projectName: string;
  readonly status: ReportedStatus;
  readonly expectedStatus: AttemptStatus;
  readonly results: readonly JsonResult[];
}

/** An error, as the reporter gives it. */
export interface JsonError {
  readonly message?: string;
  readonly stack?: string;
}

/** A file an attempt attached: a capture a test took, its trace, the context of its error. */
export interface JsonAttachment {
  readonly name: string;
  readonly contentType?: string;
  readonly path?: string;
}

/** One attempt of a test. */
export interface JsonResult {
  readonly status: AttemptStatus;
  readonly duration?: number;
  readonly errors?: readonly JsonError[];
  readonly steps?: readonly JsonStep[];
  readonly attachments?: readonly JsonAttachment[];
  readonly stdout?: readonly ({ readonly text?: string } | string)[];
  readonly stderr?: readonly ({ readonly text?: string } | string)[];
}

/** One `test.step` of an attempt, with the steps it holds. */
export interface JsonStep {
  readonly title: string;
  readonly duration?: number;
  readonly error?: JsonError;
  readonly steps?: readonly JsonStep[];
}

/** A test of a report, with the identifier the harness gives it. */
export interface ReportEntry {
  /** `<project> › <file>:<line> › <describe>… › <title>`, as the runner prints it. */
  readonly id: string;
  /** Its file, relative to the folder the runner looks for tests in, the folder of the applications of the repository. */
  readonly file: string;
  /** Its titles, those of the `describe` that hold it then its own, as `<describe>… › <title>`: with its file, what names the test from one run to the next. */
  readonly title: string;
  readonly test: JsonTest;
}

/**
 * The tests a JSON of the Playwright reporter holds, each with the identifier the harness gives it.
 *
 * @param json - The text of the JSON, as `--reporter=json` writes it after a run or with `--list`.
 * @returns The tests, in the order of the report; `undefined` when the text is not such a report.
 */
export function reportEntries(json: string): ReportEntry[] | undefined {
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
function walk(suite: JsonSuite, titles: readonly string[]): ReportEntry[] {
  const path = suite.file !== undefined && suite.title === suite.file ? titles : [...titles, suite.title ?? ""];
  const own = (suite.specs ?? []).flatMap((spec) =>
    spec.tests.map((test) => ({
      id: [test.projectName, `${spec.file}:${spec.line}`, ...path, spec.title].join(" › "),
      file: spec.file,
      title: [...path, spec.title].join(" › "),
      test,
    })),
  );
  return [...own, ...(suite.suites ?? []).flatMap((child) => walk(child, path))];
}

/**
 * The errors of an attempt, the one that came first at the head.
 *
 * @remarks
 * A test that fails, then fails again at a step it runs whatever came before, such as one that restores its data in a
 * `finally`, ends on the last error: the runner gives that one alone, and leaves the first on the step that failed. It
 * is put back here, unless an error of the attempt is that one already, with the code around it the runner adds.
 *
 * @param result - The attempt.
 * @returns Its errors; none for an attempt that has none, whatever its steps failed at and the test caught.
 */
export function attemptErrors({ errors = [], steps = [] }: JsonResult): readonly JsonError[] {
  const first = steps.find((step) => step.error !== undefined)?.error;
  const message = first?.message ?? "";
  if (errors.length === 0 || message === "" || errors.some((error) => error.message?.startsWith(message))) return errors;
  return [first!, ...errors];
}
