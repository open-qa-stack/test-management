/** A test the runner lists, in one project. */
export interface ListedTest {
  /** Identifier of the test, stable between the list and the run: its project, file, line and titles. */
  readonly id: string;
}

/** Status of a test as the runner reports it, against what was expected of it. */
export type ReportedStatus = "expected" | "unexpected" | "flaky" | "skipped";

/** Status of one attempt of a test. */
export type AttemptStatus = "passed" | "failed" | "timedOut" | "skipped" | "interrupted";

/** One attempt of a test, as the runner reports it. */
export interface ReportedAttempt {
  readonly status: AttemptStatus;
  /** The messages of its errors. */
  readonly errors: readonly string[];
  /** Title of the innermost `test.step` that failed, when one did. */
  readonly failedStep?: string;
  /** Path of its trace, as the runner wrote it, when one was kept. */
  readonly trace?: string;
  /** Path of the context the runner wrote of its error, with the snapshot of the page at the failure, when it wrote one. */
  readonly errorContext?: string;
}

/** A test as the runner reports it after a run. */
export interface ReportedTest {
  readonly id: string;
  readonly status: ReportedStatus;
  /** What the test expected of itself: `failed` for a test marked as expected to fail. */
  readonly expectedStatus: AttemptStatus;
  readonly attempts: readonly ReportedAttempt[];
}
