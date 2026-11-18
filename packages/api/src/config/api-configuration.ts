import { environmentSettings } from "./environment-settings.ts";
import type { DatabaseUrl } from "@open-qa-stack/store";
import type { ApiSettings, SessionsRuns } from "../api-entry.ts";
import type { Environment } from "./environment-variable.ts";

/** The configuration of the API, settled once at startup and injected wherever it is needed. */
export class ApiConfiguration {
  /** The address the API listens on. */
  readonly host: string;
  /** The TCP port the API listens on; `0` for any free port. */
  readonly port: number;
  /** The connection URL of the database, a secret: the one the API was given, or else the file in the state folder of its test repository. */
  readonly database: DatabaseUrl;
  /** The test repository the sessions run in, an absolute folder that holds `oqas.json`; `undefined` when the API was given none. */
  readonly repository: string | undefined;
  /** The absolute folder of the built console the API serves; `undefined` when the API was given none. */
  readonly console: string | undefined;
  /** What the runs of the sessions work with. */
  readonly runs: SessionsRuns;

  private constructor(settings: ApiSettings) {
    this.host = settings.host;
    this.port = settings.port;
    this.database = settings.database;
    this.repository = settings.repository;
    this.console = settings.console;
    this.runs = settings.runs;
    Object.freeze(this);
  }

  /**
   * @param settings - What the API is started with, already resolved by whoever starts it.
   * @returns The configuration that holds them.
   */
  static of(settings: ApiSettings): ApiConfiguration {
    return new ApiConfiguration(settings);
  }

  /**
   * Reads and validates the configuration of an API started as a program.
   *
   * @param env - The environment of the process.
   * @throws {@link ConfigurationError} naming every variable that is missing or invalid.
   */
  static read(env: Environment): ApiConfiguration {
    return new ApiConfiguration(environmentSettings(env));
  }
}
