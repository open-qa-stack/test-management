/** Where an execution of tests comes from: `design` for the run of the tests a session of design wrote. */
export type ExecutionOrigin = "design";

/**
 * What came of a test in an execution, as the runner reported it: `passed` when it went as expected, `failed` when it
 * did not, `flaky` when it passed only on a retry, `skipped` when it did not run.
 */
export type ExecutionVerdict = "passed" | "failed" | "flaky" | "skipped";

/** A test as one execution ran it, named the same from one execution to the next, with the version it ran at. */
export interface ExecutionResult {
  /** The path of its file, relative to the root of the test repository: with its title, what names the test. */
  readonly path: string;
  /** Its titles, those of the `describe` that hold it then its own, as `<describe>… › <title>`. */
  readonly title: string;
  /** The project of the runner it ran in. */
  readonly project: string;
  readonly verdict: ExecutionVerdict;
  /** How long its attempts took together, in milliseconds. */
  readonly durationMs: number;
  /** The SHA-256 of its file when the execution was kept, in hexadecimal; left out when the file could not be read. */
  readonly fileDigest?: string;
}

/** An execution of tests, with what came of each one. */
export interface Execution {
  readonly id: string;
  readonly origin: ExecutionOrigin;
  /** The session the execution belongs to, for one a session ran. */
  readonly sessionId?: string;
  /** When the execution was kept, as an ISO 8601 date. */
  readonly ranAt: string;
  /** The commit the test repository was at, when it had one. */
  readonly commit?: string;
  /** The report of the runner, relative to the test repository. */
  readonly report: string;
  /** Each test it ran, in the order of the report. */
  readonly results: readonly ExecutionResult[];
}

/** A page of the executions of tests the instance keeps, the latest first, as `GET /executions` answers. */
export interface ExecutionList {
  readonly items: readonly Execution[];
  /** The identifier of the last execution of the page, to ask for the page after it; left out on the last page. */
  readonly next?: string;
}

/** Which executions a page keeps by what came of their tests: `failing` when one of them failed, `passing` when none did. */
export type ExecutionOutcome = "failing" | "passing";

/** Which executions to read, the latest first. */
export interface ExecutionQuery {
  /** How many executions a page holds at most. */
  readonly limit: number;
  /** The identifier of an execution: the page starts after it. */
  readonly before?: string;
  readonly outcome?: ExecutionOutcome;
}

/** What came of a test in one execution, with the execution it came in, but not the other tests of it. */
export interface TestExecution extends Omit<Execution, "report" | "results"> {
  readonly result: ExecutionResult;
}

/** The executions of the tests of one file, the latest first, as `GET /tests/executions` answers. */
export interface TestExecutionList {
  readonly items: readonly TestExecution[];
}
