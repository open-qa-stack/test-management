import { absolutePath, commandLine, databaseUrl, nonEmptyText, portNumber } from "./value-type.ts";
import type { CommandLine } from "./command-line.ts";
import type { DatabaseUrl } from "./database-url.ts";
import type { EnvironmentVariable } from "./environment-variable.ts";

/** The variables that reach the database, read by the API and by the migration command alike. */
export const DATABASE_VARIABLES = {
  database: {
    name: "OQAS_DATABASE_URL",
    description: "The connection URL of the PostgreSQL database of the instance.",
    type: databaseUrl,
    secret: true,
    example: "postgres://oqas:change-me@127.0.0.1:5432/oqas",
  } satisfies EnvironmentVariable<DatabaseUrl>,
} as const;

/** Every environment variable the API reads; the documentation of the package lists the same. */
export const API_VARIABLES = {
  host: {
    name: "OQAS_HOST",
    description: "The address the API listens on.",
    type: nonEmptyText,
    secret: false,
    defaultValue: "0.0.0.0",
    example: "127.0.0.1",
  } satisfies EnvironmentVariable<string>,
  port: {
    name: "OQAS_PORT",
    description: "The TCP port the API listens on.",
    type: portNumber,
    secret: false,
    example: "8080",
  } satisfies EnvironmentVariable<number>,
  ...DATABASE_VARIABLES,
  soloRepository: {
    name: "OQAS_SOLO_REPOSITORY",
    description:
      "The test repository whose runs of the oqas command line the instance shows as sessions: a bridge, until workers write the sessions to the database.",
    type: absolutePath,
    secret: false,
    optional: true,
    example: "/srv/tests",
  } satisfies EnvironmentVariable<string>,
  soloCommand: {
    name: "OQAS_SOLO_COMMAND",
    description: "The command that starts oqas, which opening a session from the instance runs on that repository: part of the same bridge.",
    type: commandLine,
    secret: false,
    optional: true,
    example: "node /clone/packages/cli/src/main.ts",
  } satisfies EnvironmentVariable<CommandLine>,
} as const;
