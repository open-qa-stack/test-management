import { instanceDatabaseUrl } from "@open-qa-stack/store";
import { API_VARIABLES } from "./api-variables.ts";
import { readVariables } from "./read-variables.ts";
import type { ApiSettings } from "../api-entry.ts";
import type { Environment } from "./environment-variable.ts";

/**
 * Reads and validates the settings of an API started as a program: its settings are its variables, and its
 * runs read the same environment for what the configuration of the test repository names — the key of the
 * model, the test accounts — as the command line does.
 *
 * @param env - The environment of the process.
 * @returns The settings.
 * @throws {@link ConfigurationError} naming every variable that is missing or invalid.
 */
export function environmentSettings(env: Environment): ApiSettings {
  const { host, port, database, repository, console } = readVariables(API_VARIABLES, env);
  return { host, port, database: instanceDatabaseUrl(database, repository), repository, console, runs: { env } };
}
