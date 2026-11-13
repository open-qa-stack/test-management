/** One verification of the check. */
export interface Step {
  /** The name the check gives the step in its output. */
  readonly name: string;
  /**
   * Runs the verification. A command the step starts writes to the outputs of the check.
   *
   * @returns What the step found wrong, one line each; empty when the step passed.
   */
  run(): Promise<readonly string[]>;
}
