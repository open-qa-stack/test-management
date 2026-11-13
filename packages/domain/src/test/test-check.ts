/** A test file an agent proposes, before it is written to the test repository. */
export interface ProposedTest {
  /** Path the file would have, relative to the root of the test repository, such as `apps/policies/renew-policy.spec.ts`. */
  readonly path: string;
  /** Content of the file. */
  readonly content: string;
}

/** Where a finding points in a proposed test, both counted from 1. */
export interface FindingPosition {
  readonly line: number;
  readonly column: number;
}

/** An error the TypeScript compiler reports, or a syntax error. */
export interface CompilerFinding extends FindingPosition {
  readonly kind: "compiler";
  /** Code of the compiler error, such as `TS2322`, or `syntax` when the file does not parse. */
  readonly code: string;
  readonly message: string;
}

/** A rule of the test charter the test breaks. */
export interface CharterFinding extends FindingPosition {
  readonly kind: "charter";
  /** Identifier of the rule of the charter, such as `PW-WAIT-01`. */
  readonly rule: string;
  readonly message: string;
}

/** What a proposed test must change before it is written. */
export type TestFinding = CompilerFinding | CharterFinding;

/**
 * Checks proposed tests before they are written: a test with findings goes back to the agent that
 * proposed it. A check filters; it does not run the test and does not pronounce it valid.
 */
export interface TestCheck {
  /**
   * Checks a proposed test.
   *
   * @param test - The proposed file.
   * @returns The findings, by line and column; none when the test may be written.
   */
  check(test: ProposedTest): Promise<readonly TestFinding[]>;
}
