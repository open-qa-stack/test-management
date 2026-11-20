import type { ExecutionVerdict } from "./execution.ts";

/** What a launch is asked to run: tests of the repository as they are, with no agent. */
export interface LaunchRequest {
  /** The files of tests, relative to the root of the test repository; every test of the repository when left out or empty. */
  readonly paths?: readonly string[];
  /** The environment the tests run against; the one the configuration declares when it declares only one. */
  readonly environment?: string;
  /** The campaign the tests are launched for: their execution belongs to it. */
  readonly campaign?: string;
}

/** A test a launch finished, as the runner told it while the others still ran. */
export interface FinishedTest {
  /** The path of its file, relative to the root of the test repository. */
  readonly path: string;
  readonly title: string;
  readonly verdict: ExecutionVerdict;
}

/** How far a launch that runs went: how many tests it runs, once the runner listed them, and those it finished. */
export interface LaunchProgress {
  /** How many tests it runs; left out until the runner listed them. */
  readonly total?: number;
  /** The tests it finished, in the order they finished. */
  readonly finished: readonly FinishedTest[];
}

/** A launch of tests that started: the tests it runs, and where. */
export interface TestLaunch {
  /** When it started, as an ISO 8601 date. */
  readonly startedAt: string;
  readonly environment: string;
  /** The files of tests it runs; none for every test of the repository. */
  readonly paths: readonly string[];
  /** The campaign it runs the tests of, for one launched for a campaign. */
  readonly campaign?: string;
  /** How far it went, for one that runs; left out once it ended, and until the runner started. */
  readonly progress?: LaunchProgress;
}

/** A launch of tests that ended: the execution it kept, or why it kept none. */
export interface EndedLaunch extends TestLaunch {
  /** When it ended, as an ISO 8601 date. */
  readonly endedAt: string;
  /** The identifier of the execution it kept; left out when it kept none. */
  readonly execution?: string;
  /** Why it kept no execution: the runner wrote no report, or the store refused it. */
  readonly failure?: string;
}

/** The launches of tests of the instance, as `GET /executions/launch` answers: the one that runs, and the last one that ended. */
export interface LaunchState {
  readonly running?: TestLaunch;
  readonly last?: EndedLaunch;
}
