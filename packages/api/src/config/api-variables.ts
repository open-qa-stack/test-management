import { nonEmptyText, portNumber } from "./value-type.ts";
import type { EnvironmentVariable } from "./environment-variable.ts";

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
} as const;
