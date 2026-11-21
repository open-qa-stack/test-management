import { pointer } from "./errors.ts";
import type { OqasConfig } from "./types.ts";

/** An environment variable a configuration names, and where. */
export interface DeclaredVariable {
  /** JSON Pointer to the key that names it. */
  readonly path: string;
  /** Name of the variable. */
  readonly name: string;
}

/** The sections of a configuration that name environment variables. */
export type VariableSections = Pick<OqasConfig, "applications" | "knowledge" | "model">;

/**
 * Lists the environment variables a configuration names: the credentials of the test accounts, the
 * connection strings of the databases and the key of the model.
 *
 * @param config - The configuration.
 * @returns Each variable where it is named, in the order of the file.
 */
export function declaredVariables(config: VariableSections): DeclaredVariable[] {
  const variables: DeclaredVariable[] = [];
  config.applications.forEach((app, i) => {
    (app.authentication.accounts ?? []).forEach((account, j) => {
      const base = pointer(pointer(pointer(pointer("/applications", i), "authentication"), "accounts"), j);
      variables.push({ path: pointer(base, "usernameEnv"), name: account.usernameEnv }, { path: pointer(base, "passwordEnv"), name: account.passwordEnv });
    });
  });
  config.knowledge.forEach((item, i) => {
    if (item.type === "postgresql") variables.push({ path: pointer(pointer("/knowledge", i), "connectionStringEnv"), name: item.connectionStringEnv });
  });
  if (config.model.mode === "provider-key" && config.model.apiKeyEnv !== undefined) variables.push({ path: "/model/apiKeyEnv", name: config.model.apiKeyEnv });
  return variables;
}

/**
 * The environment variables of a configuration whose values are secrets: the connection strings of the
 * databases and the key of the model. The credentials of the test accounts are not: a test environment shows
 * them, an agent types them and a test may hold them.
 *
 * @param config - The configuration.
 * @returns Each such variable where it is named, in the order of the file.
 */
export function secretVariables(config: VariableSections): DeclaredVariable[] {
  return declaredVariables(config).filter(({ path }) => !path.startsWith("/applications"));
}

/**
 * The values of the secrets a configuration names, which no tool shows to an agent where it can
 * mask them.
 *
 * @param config - The configuration.
 * @param env - The environment the configuration reads.
 * @returns The values set and not empty, each once.
 */
export function declaredValues(config: VariableSections, env: Readonly<Record<string, string | undefined>>): string[] {
  return [...new Set(secretVariables(config).flatMap(({ name }) => (env[name] ? [env[name]] : [])))];
}
