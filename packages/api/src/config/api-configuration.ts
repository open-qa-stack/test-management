import { API_VARIABLES } from "./api-variables.ts";
import type { Environment } from "./environment-variable.ts";
import { readVariables } from "./read-variables.ts";

/** The configuration of the API, read once at startup and injected wherever it is needed. */
export class ApiConfiguration {
  /** The address the API listens on. */
  readonly host: string;
  /** The TCP port the API listens on. */
  readonly port: number;

  private constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
    Object.freeze(this);
  }

  /**
   * Reads and validates the configuration.
   *
   * @param env - The environment of the process.
   * @throws {@link ConfigurationError} naming every variable that is missing or invalid.
   */
  static read(env: Environment): ApiConfiguration {
    const { host, port } = readVariables(API_VARIABLES, env);
    return new ApiConfiguration(host, port);
  }
}
