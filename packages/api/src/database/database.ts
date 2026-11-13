import { Logger, type LoggerService, type OnApplicationShutdown } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import type { DatabaseUrl } from "../config/database-url.ts";
import { DatabaseUnavailableError } from "./database-unavailable-error.ts";

const CONNECTION_TIMEOUT_MS = 3000;

/** The pool of connections to the database of the instance, the only way the API reaches it. */
export class Database implements OnApplicationShutdown {
  readonly #url: DatabaseUrl;
  readonly #pool: Pool;

  /**
   * Opens no connection until one is needed.
   *
   * @param url - The connection URL of the database.
   * @param logger - Where a connection dropped while idle is reported.
   */
  constructor(url: DatabaseUrl, logger: LoggerService = new Logger("Database")) {
    this.#url = url;
    this.#pool = new Pool({ connectionString: url.reveal(), connectionTimeoutMillis: CONNECTION_TIMEOUT_MS });
    this.#pool.on("error", (error) => logger.warn(this.#unavailable(error).message));
  }

  /**
   * Runs some work on one connection, then hands the connection back to the pool.
   *
   * @param work - What to do with the connection.
   * @returns What the work returns.
   * @throws {@link DatabaseUnavailableError} when no connection can be opened; an error of the work passes through.
   */
  async withClient<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try {
      client = await this.#pool.connect();
    } catch (error) {
      throw this.#unavailable(error);
    }
    try {
      return await work(client);
    } finally {
      client.release();
    }
  }

  /** Closes every connection. */
  async close(): Promise<void> {
    await this.#pool.end();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }

  #unavailable(error: unknown): DatabaseUnavailableError {
    // Refused on every address of a name, the client raises an aggregate error with an empty message.
    const { message, code } = error as { message: string; code?: string };
    return new DatabaseUnavailableError(this.#url.redact(message === "" ? String(code) : message));
  }
}
