import type { ResolvedConfig } from "@open-qa-stack/shared";
import { secretForms, secretPaths } from "@open-qa-stack/tools";
import type { IndexError } from "@open-qa-stack/shared";

/**
 * The secrets of a configuration: every value it reads from the environment for a password of a test
 * account, a connection string or the key of the model.
 *
 * @param config - The resolved configuration.
 * @param env - The environment the configuration reads.
 * @returns The values set and not empty.
 */
export function configSecrets(config: ResolvedConfig, env: Readonly<Record<string, string | undefined>>): string[] {
  const variables = [
    ...config.applications.flatMap((application) => (application.authentication.accounts ?? []).map((account) => account.passwordEnv)),
    ...config.knowledge.flatMap((source) => (source.type === "postgresql" ? [source.connectionStringEnv] : [])),
    ...(config.model.apiKeyEnv === undefined ? [] : [config.model.apiKeyEnv]),
  ];
  return variables.flatMap((variable) => (env[variable] ?? "") || []);
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
  return secretPaths(value, secrets.flatMap(secretForms)).map((path) => ({ path, message: `${path} holds a secret of the configuration; write it without the secret.` }));
}
