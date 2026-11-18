/**
 * Where a session is: `running` while its agents work, `completed` once the work ended, and `interrupted` when
 * it stopped without ending. A client reads a state it does not know as a session that no longer goes on.
 */
export type SessionState = "running" | "completed" | "interrupted";

/** The verdict of a test, as the harness pronounces it. */
export type TestVerdict = "passed" | "failed" | "blocked" | "indeterminate" | "skipped" | "not_run";

/** The verdict of a test a session produced. */
export interface SessionTest {
  /** The test, as its runner names it. */
  readonly id: string;
  readonly verdict: TestVerdict;
  /** Why. */
  readonly reason: string;
}

/** What a session came to, once it is completed. */
export interface SessionResult {
  /**
   * How it ended: `passed` when every test passed, `failed` when one failed, `inconclusive` when one has no
   * verdict of success or failure, `stopped` when the work did not go to its end.
   */
  readonly outcome: "passed" | "failed" | "inconclusive" | "stopped";
  /** How long the work took, in milliseconds. */
  readonly durationMs: number;
  /** How many requests it sent to the model. */
  readonly modelRequests: number;
  /** The branch of the test repository its tests were written on, when they were. */
  readonly branch?: string;
  /** The verdict of each test. */
  readonly tests: readonly SessionTest[];
}

/** A request made to the agents, and the work it opened. */
export interface Session {
  readonly id: string;
  /** What was asked, in the words of the person; left out when nothing was. */
  readonly request?: string;
  /** The environment the work targets, once it is known. */
  readonly environment?: string;
  /** When the session was opened, as an ISO 8601 date. */
  readonly openedAt: string;
  /** When its last event happened, as an ISO 8601 date. */
  readonly lastEventAt: string;
  readonly state: SessionState;
  /** What it came to; present once it is completed. */
  readonly result?: SessionResult;
}

/** The sessions of a project, the latest first. */
export interface SessionList {
  readonly items: readonly Session[];
}

/** What a person sends to open a session. */
export interface SessionOpening {
  /** What to test, in the words of the person. */
  readonly request: string;
  /** The environment to work against; the only one the project declares when left out. */
  readonly environment?: string;
}
