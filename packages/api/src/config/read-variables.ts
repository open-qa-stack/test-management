import { ConfigurationError } from "./configuration-error.ts";
import type { Environment, EnvironmentVariable } from "./environment-variable.ts";

/** The values read for a set of declared variables, under the keys of the declarations. */
export type VariableValues<V extends Record<string, EnvironmentVariable<unknown>>> = {
  readonly [K in keyof V]: V[K] extends EnvironmentVariable<infer T> ? T : never;
};

/**
 * Reads every declared variable from an environment.
 *
 * @param variables - The declared variables, under the keys their values are returned with.
 * @param env - The environment to read.
 * @returns The value of each variable, its default applied.
 * @throws {@link ConfigurationError} naming every variable that is missing or invalid.
 */
export function readVariables<V extends Record<string, EnvironmentVariable<unknown>>>(variables: V, env: Environment): VariableValues<V> {
  const values: Record<string, unknown> = {};
  const violations: string[] = [];
  for (const [key, variable] of Object.entries(variables)) {
    const raw = env[variable.name] ?? variable.defaultValue;
    if (raw === undefined) {
      violations.push(`${variable.name} is required and is not set.`);
      continue;
    }
    const parsed = variable.type.parse(raw);
    if (parsed.ok) values[key] = parsed.value;
    else violations.push(`${variable.name} must be ${variable.type.rule}.`);
  }
  if (violations.length > 0) throw new ConfigurationError(violations);
  return values as VariableValues<V>;
}
