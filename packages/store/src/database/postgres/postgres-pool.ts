import { Pool } from "pg";
import { DatabaseUnavailableError } from "../database-unavailable-error.ts";
import type { PostgresPool } from "kysely";
import type { StoreLogger } from "../../store-logger.ts";
import type { DatabaseUrl } from "../database-url.ts";

const CONNECTION_TIMEOUT_MS = 3000;

/**
 * The pool of connections to a PostgreSQL server, as the query builder takes one. It opens no connection until
 * one is needed, and says that the database is unavailable when none can be opened, without its URL nor its
 * password.
 *
 * @param url - The connection URL of the server.
 * @param logger - Where a connection dropped while idle is reported.
 * @returns The pool, whose `connect` raises a {@link DatabaseUnavailableError} when no connection can be opened.
 */
export function postgresPool(url: DatabaseUrl, logger: StoreLogger): PostgresPool {
  const pool = new Pool({ connectionString: url.reveal(), connectionTimeoutMillis: CONNECTION_TIMEOUT_MS });
  const unavailable = (error: unknown): DatabaseUnavailableError => {
    // Refused on every address of a name, the client raises an aggregate error with an empty message.
    const { message, code } = error as { message: string; code?: string };
    return new DatabaseUnavailableError(url.redact(message === "" ? String(code) : message));
  };
  pool.on("error", (error) => logger.warn(unavailable(error).message));
  return {
    options: pool.options,
    connect: () =>
      pool.connect().catch((error: unknown) => {
        throw unavailable(error);
      }),
    end: () => pool.end(),
  };
}
