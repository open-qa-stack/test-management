/** A rule that finds a secret in a line of text. */
export interface SecretRule {
  /** The name the findings give the rule. */
  readonly name: string;
  /** What it finds, as an extended regular expression that git and JavaScript read the same way. */
  readonly pattern: string;
}

/** The rules of the scan, which find secrets by their format alone. */
export const SECRET_RULES: readonly SecretRule[] = [
  { name: "private-key", pattern: "-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY-----" },
  { name: "github-token", pattern: "gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82}" },
];
