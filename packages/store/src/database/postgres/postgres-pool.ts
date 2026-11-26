import { Pool } from "pg";
import { DatabaseUnavailableError } from "../database-unavailable-error.ts";
import type { PostgresPool, PostgresPoolClient } from "kysely";
import type { StoreLogger } from "../../store-logger.ts";
import type { DatabaseUrl } from "../database-url.ts";

const CONNECTION_TIMEOUT_MS = 3000;

/**
 * The codes by which the server tells that a connection is lost: the class `08` of the connection exceptions, and
 * the server or an administrator ending the connection (`57P01` to `57P03`).
 */
const LOST = /^(08|57P0[1-3])/;

/**
 * The pool of connections to a PostgreSQL server, as the query builder takes one. It opens no connection until
 * one is needed, and says that the database is unavailable when none can be opened, or when the server drops a
 * connection under a statement, without its URL nor its password.
 *
 * @param url - The connection URL of the server.
 * @param logger - Where a connection the server dropped is reported, idle or lent.
 * @returns The pool, whose `connect` raises a {@link DatabaseUnavailableError} when no connection can be opened, and
 * whose connections raise one when the server drops them; they take statements, not cursors, which the store reads none with.
 */
export function postgresPool(url: DatabaseUrl, logger: StoreLogger): PostgresPool {
  const pool = new Pool({ connectionString: url.reveal(), connectionTimeoutMillis: CONNECTION_TIMEOUT_MS });
  const unavailable = (error: unknown): DatabaseUnavailableError => {
    // Refused on every address of a name, the client raises an aggregate error with an empty message.
    const { message, code } = error as { message: string; code?: string };
    return new DatabaseUnavailableError(url.redact(message === "" ? String(code) : message));
  };
  const dropped = (error: Error): void => logger.warn(unavailable(error).message);
  pool.on("error", dropped);
  return {
    options: pool.options,
    connect: async () => {
      const client = await pool.connect().catch((error: unknown) => {
        throw unavailable(error);
      });
      // The pool hears a connection only while it is idle: lent, one the server drops would otherwise end the process.
      client.on("error", dropped);
      // A connection the server ended while it was idle may be lent before the pool heard of it.
      const query = async (text: string, parameters: readonly unknown[]) =>
        client.query(text, [...parameters]).catch((error: unknown) => {
          throw LOST.test(String((error as { code?: unknown }).code)) ? unavailable(error) : error;
        });
      // `processID`, which the client of the driver holds without declaring it, spares the query builder asking for it.
      const lent = {
        processID: (client as { processID?: number }).processID,
        query,
        release: (destroy?: boolean) => {
          client.off("error", dropped);
          client.release(destroy);
        },
      };
      return lent as unknown as PostgresPoolClient;
    },
    end: () => pool.end(),
  };
}
