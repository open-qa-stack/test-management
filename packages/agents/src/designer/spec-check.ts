/** A test file the designer proposes, once the harness found nothing to refuse in it. */
export interface ProposedSpec {
  /** Path of the file, relative to the root of the test repository, with forward slashes. */
  readonly path: string;
  /** Its text. */
  readonly content: string;
}

/**
 * A check of the proposed tests against rules the harness does not check itself, such as those of the
 * test charter, run before a test is accepted.
 */
export interface SpecCheck {
  /**
   * Checks a proposed test.
   *
   * @param spec - The test.
   * @returns What the test breaks, each finding in one sentence; none when it passes.
   */
  check(spec: ProposedSpec): Promise<readonly string[]>;
}
