/** A rule of the linter, with the options it runs with. */
export interface LintRule {
  /** Name of the rule in the linter configuration, such as `playwright/no-wait-for-timeout`. */
  readonly name: string;
  /** Options that follow the severity in the configuration. */
  readonly options?: readonly unknown[];
}

/** How a rule of the default charter is checked before a test is written. */
export interface CharterControl {
  /** Identifier of the rule of the charter. */
  readonly rule: string;
  /** Lint rules whose findings cite the rule; none when the rule is not checked mechanically. */
  readonly lint: readonly LintRule[];
  /** What the lint rules flag, or why the rule is left to review. */
  readonly note: string;
}
