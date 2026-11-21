import type { IndexError, ResolvedConfig } from "@open-qa-stack/domain";
import { secretForms, secretPaths } from "@open-qa-stack/tools";

/**
 * The secrets of a configuration that no text written by an agent may hold: every connection string and the
 * key of the model, as the environment gives them.
 *
 * @remarks
 * The passwords — of the test accounts, or inside a connection string — are not among them. The tools never
 * give them to the agent; one it still writes was read in the sources, and refusing it would refuse every
 * name that holds it, as an application name often does.
 *
 * @param config - The resolved configuration.
 * @param env - The environment the configuration reads.
 * @returns The values set and not empty.
 */
export function configSecrets(config: ResolvedConfig, env: Readonly<Record<string, string | undefined>>): string[] {
  const value = (variable: string): string[] => (env[variable] ? [env[variable]] : []);
  const connections = config.knowledge.flatMap((source) => (source.type === "postgresql" ? value(source.connectionStringEnv) : []));
  const key = config.model.mode === "github" || config.model.apiKeyEnv === undefined ? [] : value(config.model.apiKeyEnv);
  return [...new Set([...connections, ...key])];
}

/**
 * Refuses the strings of a submission that hold a secret, so that no card nor index written in the test
 * repository holds one.
 *
 * @param value - The submission.
 * @param secrets - The secrets of the configuration.
 * @returns An error for each string that holds one, which names its place but never the secret.
 */
export function secretErrors(value: unknown, secrets: readonly string[]): IndexError[] {
  return secretPaths(value, secrets.flatMap(secretForms)).map((path) => ({
    path,
    message: `${path} holds a secret of the configuration; write it without the secret.`,
  }));
}
