import { declaredVariables, type VariableSections } from "../config/declared-variables.ts";
import type { SecretKind, SecretState } from "./secret-state.ts";

/** What the key that names a variable says it holds, by the end of its pointer. */
const KINDS: Readonly<Record<string, SecretKind>> = {
  apiKeyEnv: "model_key",
  connectionStringEnv: "connection_string",
  usernameEnv: "account_username",
  passwordEnv: "account_password",
};

/**
 * Lists the variables a configuration names, each once, with what it holds: those whose value a person gives, in
 * the console or in a terminal, when the environment does not set it.
 *
 * @param config - The configuration.
 * @returns Each variable once, at every key that names it, in the order of the file.
 */
export function declaredSecrets(config: VariableSections): Omit<SecretState, "source">[] {
  const named = new Map<string, { kind: SecretKind; paths: string[] }>();
  for (const { path, name } of declaredVariables(config)) {
    const known = named.get(name);
    if (known === undefined) named.set(name, { kind: KINDS[path.slice(path.lastIndexOf("/") + 1)]!, paths: [path] });
    else known.paths.push(path);
  }
  return [...named].map(([name, { kind, paths }]) => ({ name, kind, paths }));
}
