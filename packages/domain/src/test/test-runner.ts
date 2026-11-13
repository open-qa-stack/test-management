import type { ProposedTest } from "./test-check.ts";
import type { Verdict } from "./verdict.ts";

/** A test of a file that was tried, as the harness pronounced it. */
export interface TriedTest {
  /** Identifier of the test: its project, file, line and titles. */
  readonly id: string;
  /** The verdict the harness pronounced on the test. */
  readonly verdict: Verdict;
  /** Why: the error of a test that did not pass, in full; a line otherwise. */
  readonly reason: string;
  /** Title of the `test.step` that failed, when one did. */
  readonly failedStep?: string;
  /** Path of the trace of the failed attempt, relative to the test repository, when one was kept. */
  readonly trace?: string;
}

/** What trying a test file gave. */
export interface TestTrial {
  /** When the run started, as an ISO 8601 date: the logs of the services are read from it. */
  readonly startedAt: string;
  /** Each test of the file; none when the file could not run, and `error` says why. */
  readonly tests: readonly TriedTest[];
  /** Why the file could not run, when it could not. */
  readonly error?: string;
}

/**
 * Runs a test file with the real runner, against the application, before it is written: the designer
 * tries each test it writes.
 */
export interface TestRunner {
  /**
   * Tries a test file.
   *
   * @param test - The file, at the path it would have.
   * @returns The verdict of each of its tests.
   */
  run(test: ProposedTest): Promise<TestTrial>;
}
