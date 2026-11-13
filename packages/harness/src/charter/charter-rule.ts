/** A rule the test designer and the reviewer apply, as the instructions present it. */
export interface ActiveRule {
  /** Stable identifier, cited by the reviewer, such as `PW-WAIT-01`. */
  readonly id: string;
  /** What a test must or must not do. */
  readonly statement: string;
  /** Why the rule holds. */
  readonly rationale: string;
  /** A conforming excerpt of a test; a rule added by the configuration has none. */
  readonly example?: string;
}

/** A rule of the default test charter. */
export interface CharterRule extends ActiveRule {
  /** Page of the Playwright documentation the rationale relies on. */
  readonly source: string;
  readonly example: string;
}
