import type { ResolvedConfig } from "@open-qa-stack/shared";
import { secretForms, secretPaths } from "@open-qa-stack/tools";
import type { IndexError } from "@open-qa-stack/shared";

/**
 * The secrets of a configuration: every value it reads from the environment for a password of a test
 * account, a connection string or the key of the model, and the password a connection string holds.
 *
 * @param config - The resolved configuration.
 * @param env - The environment the configuration reads.
 * @returns The values set and not empty.
 */
export function configSecrets(config: ResolvedConfig, env: Readonly<Record<string, string | undefined>>): string[] {
  const value = (variable: string): string[] => (env[variable] ? [env[variable]] : []);
  const passwords = config.applications.flatMap((application) => (application.authentication.accounts ?? []).flatMap((account) => value(account.passwordEnv)));
  const connections = config.knowledge.flatMap((source) => (source.type === "postgresql" ? value(source.connectionStringEnv) : []));
  const key = config.model.apiKeyEnv === undefined ? [] : value(config.model.apiKeyEnv);
  return [...new Set([...passwords, ...connections, ...connections.flatMap(connectionPasswords), ...key])];
}

/** A keyword `password=` of a connection string written as keywords, quoted or not. */
const KEYWORD_PASSWORD = /(?:^|\s)password\s*=\s*(?:'((?:[^'\\]|\\.)*)'|(\S+))/;

/**
 * The password a PostgreSQL connection string holds: in its address (`postgresql://user:pass@host`), in its
 * query (`?password=`), or as a keyword (`password=pass host=…`).
 */
function connectionPasswords(connection: string): string[] {
  const address = URL.canParse(connection) ? new URL(connection) : undefined;
  const keyword = KEYWORD_PASSWORD.exec(connection);
  const found = [
    address === undefined || address.password === "" ? undefined : decodeURIComponent(address.password),
    address?.searchParams.get("password") ?? undefined,
    keyword === null ? undefined : (keyword[1]?.replace(/\\(.)/g, "$1") ?? keyword[2]),
  ];
  return found.filter((password): password is string => password !== undefined && password !== "");
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
