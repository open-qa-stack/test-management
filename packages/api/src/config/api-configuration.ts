import { API_VARIABLES } from "./api-variables.ts";
import { instanceDatabaseUrl, type DatabaseUrl } from "@open-qa-stack/store";
import type { Environment } from "./environment-variable.ts";
import { readVariables, type VariableValues } from "./read-variables.ts";

/** The configuration of the API, read once at startup and injected wherever it is needed. */
export class ApiConfiguration {
  /** The address the API listens on. */
  readonly host: string;
  /** The TCP port the API listens on. */
  readonly port: number;
  /** The connection URL of the database, a secret: the one the API was given, or else the file in the state folder of its test repository. */
  readonly database: DatabaseUrl;
  /** The test repository the sessions run in, an absolute folder that holds `oqas.json`; `undefined` when the API was given none. */
  readonly repository: string | undefined;

  private constructor(values: VariableValues<typeof API_VARIABLES>) {
    this.host = values.host;
    this.port = values.port;
    this.database = instanceDatabaseUrl(values.database, values.repository);
    this.repository = values.repository;
    Object.freeze(this);
  }

  /**
   * Reads and validates the configuration.
   *
   * @param env - The environment of the process.
   * @throws {@link ConfigurationError} naming every variable that is missing or invalid.
   */
  static read(env: Environment): ApiConfiguration {
    return new ApiConfiguration(readVariables(API_VARIABLES, env));
  }
}
