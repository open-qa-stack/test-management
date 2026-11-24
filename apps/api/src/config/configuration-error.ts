/**
 * Raised at startup when the environment does not hold a valid configuration.
 *
 * @remarks
 * The message names each variable at fault and the rule it breaks, never its value.
 */
export class ConfigurationError extends Error {
  /** One sentence per variable at fault. */
  readonly violations: readonly string[];

  constructor(violations: readonly string[]) {
    super(["The configuration is invalid:", ...violations.map((violation) => `- ${violation}`)].join("\n"));
    this.name = "ConfigurationError";
    this.violations = violations;
  }
}
