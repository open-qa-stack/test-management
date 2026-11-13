import type { SqlClient } from "./sql-client.ts";

/**
 * A client that reads its connection string only when a query runs, so that a missing one fails the call
 * rather than the session.
 *
 * @param variable - Name of the environment variable that holds the connection string.
 * @param env - The environment.
 * @param make - Makes the client of a connection string.
 * @returns The client.
 */
export function lazySqlClient(variable: string, env: Readonly<Record<string, string | undefined>>, make: (connectionString: string) => SqlClient): SqlClient {
  return {
    query: (text, values) => {
      const connectionString = env[variable];
      if (connectionString === undefined || connectionString === "") {
        return Promise.reject(new Error(`Environment variable ${variable} is not set.`));
      }
      return make(connectionString).query(text, values);
    },
  };
}
