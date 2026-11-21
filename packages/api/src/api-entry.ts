import type { Environment, SessionsHost } from "@open-qa-stack/engine";
import type { DatabaseUrl } from "@open-qa-stack/store";

/**
 * What the runs of the sessions work with, as the engine takes it from whoever hosts it: the environment of the
 * process, which the values saved for the variables of the configuration complete, and what a host replaces of the
 * machine.
 */
export type SessionsRuns = Pick<SessionsHost, "openRuntime" | "runner" | "now" | "writerPace" | "pace"> & { readonly env: Environment };

/** Where an API logs: what happened, what an operator should look at, and what failed. */
export interface ApiLogger {
  log(message: unknown, ...context: unknown[]): void;
  warn(message: unknown, ...context: unknown[]): void;
  error(message: unknown, ...context: unknown[]): void;
}

/**
 * Everything an API is started with. Whoever starts one resolves each of them — from its environment, from
 * its arguments — and hands them over: the API reads nothing else, the environment of its process included.
 */
export interface ApiSettings {
  /** The address the API listens on. */
  readonly host: string;
  /** The TCP port the API listens on; `0` for any free port, which {@link StartedApi.url} then tells. */
  readonly port: number;
  /** The database of the instance. */
  readonly database: DatabaseUrl;
  /** The test repository the sessions run in, an absolute folder that holds `oqas.json`; `undefined` for an API that serves the sessions it holds and opens none. */
  readonly repository: string | undefined;
  /** The absolute folder of the built console, which the API then serves beside its routes; `undefined` for an API that serves its routes alone. */
  readonly console: string | undefined;
  /** What the runs of the sessions work with. */
  readonly runs: SessionsRuns;
  /** Where the API logs; the console of the process when left out, nowhere when `false`. */
  readonly logger?: ApiLogger | false;
  /**
   * The signals that close the API, after which the process exits on the signal; none when left out: whoever
   * started the API then closes it.
   */
  readonly signals?: readonly NodeJS.Signals[];
}

/** An API that listens. */
export interface StartedApi {
  /** The address it answers at, without a path, as a browser of the machine opens it. */
  readonly url: string;
  /**
   * Closes the API: the streams of events end, the session that runs is asked to stop and awaited for a time,
   * then the database and the server close.
   */
  close(): Promise<void>;
}

/**
 * Starts an API: a database that cannot be reached does not stop the startup, and the API then reports itself
 * not ready until the database answers.
 *
 * @param settings - What the API is started with.
 * @returns The API, listening.
 * @throws `PendingMigrationsError` before anything listens, when the database is on a server that has not applied every migration.
 * @throws `DatabaseUnavailableError` before anything listens, when the file of the database cannot be opened.
 * @throws The error of the server, which bears the `code` of the system, when the address cannot be listened on: `EADDRINUSE` for a port that is taken.
 */
export type StartApi = (settings: ApiSettings) => Promise<StartedApi>;

/** The entry of the package, as the programs that start an API import it. */
export declare const startApi: StartApi;
