/**
 * Where an execution of tests comes from: `design` for the run of the tests a session of design wrote, `manual` for
 * tests of the repository a person launched as they are, with no agent.
 */
export type ExecutionOrigin = "design" | "manual";

/**
 * What came of a test in an execution, as the runner reported it: `passed` when it went as expected, `failed` when it
 * did not, `flaky` when it passed only on a retry, `skipped` when it did not run.
 */
export type ExecutionVerdict = "passed" | "failed" | "flaky" | "skipped";

/** Where a test failed and why, as the report of its last attempt says it. */
export interface ExecutionFailure {
  /** The first `test.step` of the test that failed, numbered from 1, when one did. */
  readonly step?: { readonly number: number; readonly title: string };
  /** The first line of the message of its error, without colours, when it has one. */
  readonly message?: string;
  /** What the failed assertion expected and what it received, when its message says both. */
  readonly expected?: string;
  readonly received?: string;
}

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
  /**
   * The SHA-256 of the test itself when the execution was kept, in hexadecimal: of its call in its file, without its
   * comments nor its layout, so that another test of the file, a comment or a formatting changes nothing of it. Left
   * out when its file could not be read, or does not write its call with its titles as plain texts.
   */
  readonly testDigest?: string;
  /** Whether the test was the same in the commit the execution ran at; left out with its digest, or without a commit. */
  readonly committed?: boolean;
  /** The version of the test it ran at, from 1, which the instance numbers when it keeps the execution; left out without a digest of the test. */
  readonly version?: number;
  /** Where it failed and why, for a test that failed; left out when the report says nothing of it, or for a result kept before the instance kept them. */
  readonly failure?: ExecutionFailure;
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
  /** How many executions the query keeps, every page together. */
  readonly total: number;
  /** The rank of the first execution of the page among them, from 0. */
  readonly start: number;
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
  /** An ISO 8601 date: only the executions kept from then on. */
  readonly since?: string;
}

/** What came of a test in one execution, with the execution it came in, but not the other tests of it. */
export interface TestExecution extends Omit<Execution, "report" | "results"> {
  readonly result: ExecutionResult;
}

/** The executions of the tests of one file, the latest first, as `GET /tests/executions` answers. */
export interface TestExecutionList {
  readonly items: readonly TestExecution[];
}
