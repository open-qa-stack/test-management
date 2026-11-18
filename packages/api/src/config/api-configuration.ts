import { API_VARIABLES } from "./api-variables.ts";
import type { CommandLine } from "./command-line.ts";
import type { DatabaseUrl } from "./database-url.ts";
import type { Environment } from "./environment-variable.ts";
import { readVariables, type VariableValues } from "./read-variables.ts";

/** The configuration of the API, read once at startup and injected wherever it is needed. */
export class ApiConfiguration {
  /** The address the API listens on. */
  readonly host: string;
  /** The TCP port the API listens on. */
  readonly port: number;
  /** The connection URL of the database, a secret. */
  readonly database: DatabaseUrl;
  /** The test repository whose runs of the command line are shown as sessions, when one is configured. */
  readonly soloRepository: string | undefined;
  /** The program that starts the command line, then its arguments, when sessions can be opened. */
  readonly soloCommand: CommandLine | undefined;
  /**
   * The environment of the API without the variables marked secret: all a program the API starts is given,
   * so that no secret of the instance reaches a program that has no use for it.
   */
  readonly environmentWithoutSecrets: Environment;

  private constructor(values: VariableValues<typeof API_VARIABLES>, environmentWithoutSecrets: Environment) {
    this.host = values.host;
    this.port = values.port;
    this.database = values.database;
    this.soloRepository = values.soloRepository;
    this.soloCommand = values.soloCommand;
    this.environmentWithoutSecrets = environmentWithoutSecrets;
    Object.freeze(this);
  }

  /**
   * Reads and validates the configuration.
   *
   * @param env - The environment of the process.
   * @throws {@link ConfigurationError} naming every variable that is missing or invalid.
   */
  static read(env: Environment): ApiConfiguration {
    const secrets = new Set<string>(
      Object.values(API_VARIABLES)
        .filter(({ secret }) => secret)
        .map(({ name }) => name),
    );
    const withoutSecrets = Object.fromEntries(Object.entries(env).filter(([name]) => !secrets.has(name)));
    return new ApiConfiguration(readVariables(API_VARIABLES, env), Object.freeze(withoutSecrets));
  }
}
