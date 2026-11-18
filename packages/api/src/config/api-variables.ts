import { databaseUrl, nonEmptyText, portNumber, testRepository } from "./value-type.ts";
import { DATABASE_URL_VARIABLE, type DatabaseUrl } from "@open-qa-stack/store";
import type { EnvironmentVariable } from "./environment-variable.ts";

const REPOSITORY = "OQAS_REPOSITORY";

/**
 * The variables that name the database of the instance, read by the API and by the migration command alike:
 * its URL or, without one, the test repository whose state folder holds it.
 */
export const DATABASE_VARIABLES = {
  database: {
    name: DATABASE_URL_VARIABLE,
    description:
      "The connection URL of the database of the instance, to keep it elsewhere than in the test repository. Without it, the database is a SQLite file in the state folder of the test repository.",
    type: databaseUrl,
    secret: true,
    optional: true,
    orElse: REPOSITORY,
    example: "postgres://oqas:change-me@127.0.0.1:5432/oqas",
  } satisfies EnvironmentVariable<DatabaseUrl>,
  repository: {
    name: REPOSITORY,
    description: "The test repository the sessions run in. Without it, the API serves the sessions it holds and opens none.",
    type: testRepository,
    secret: false,
    optional: true,
    example: "/srv/tests",
  } satisfies EnvironmentVariable<string>,
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
} as const;
