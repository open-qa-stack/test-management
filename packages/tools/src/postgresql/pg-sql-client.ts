import pg from "pg";
import type { SqlClient, SqlResult } from "./sql-client.ts";

/** What `PgSqlClient` needs from a PostgreSQL client; the `pg` client by default. */
export interface PgConnection {
  connect(): Promise<unknown>;
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; fields: readonly { name: string }[] }>;
  end(): Promise<void>;
}

/** Makes a connection from a connection string. */
export type PgConnect = (connectionString: string) => PgConnection;

/** Longest wait for a connection, and for a query, in milliseconds. */
export const DATABASE_TIMEOUT_MS = 5000;

const connectWithPg: PgConnect = (connectionString) =>
  new pg.Client({ connectionString, connectionTimeoutMillis: DATABASE_TIMEOUT_MS, query_timeout: DATABASE_TIMEOUT_MS });

/**
 * SqlClient over PostgreSQL that runs each query alone, read-only and bounded in time.
 *
 * @remarks
 * Each query opens a connection, runs in a read-only transaction with a statement timeout, is rolled
 * back and closes the connection, so that a tool can neither write nor hang the session. Agents read the
 * catalog rarely: nothing is kept open between tool calls. Errors never repeat the connection string, and
 * carry the error of the driver as their cause, with its SQLSTATE `code`.
 */
export class PgSqlClient implements SqlClient {
  private readonly connectionString: string;
  private readonly connect: PgConnect;

  /**
   * @param connectionString - Where the database is, with its credentials.
   * @param connect - Makes the connection; the `pg` client when absent.
   */
  public constructor(connectionString: string, connect: PgConnect = connectWithPg) {
    this.connectionString = connectionString;
    this.connect = connect;
  }

  /** {@inheritDoc SqlClient.query} */
  public async query(text: string, values: readonly unknown[]): Promise<SqlResult> {
    const connection = this.connect(this.connectionString);
    const result = this.runReadOnly(connection, text, values).finally(() => connection.end());
    return result.catch((failure: unknown) => {
      throw new Error(`The database query failed: ${describe(failure)}.`, { cause: failure });
    });
  }

  private async runReadOnly(connection: PgConnection, text: string, values: readonly unknown[]): Promise<SqlResult> {
    await connection.connect();
    await connection.query("BEGIN READ ONLY");
    await connection.query(`SET LOCAL statement_timeout = ${DATABASE_TIMEOUT_MS}`);
    const { rows, fields } = await connection.query(text, [...values]);
    await connection.query("ROLLBACK");
    return { columns: fields.map((field) => field.name), rows };
  }
}

/** A readable reason for a driver error, which may come with an empty message. */
function describe(failure: unknown): string {
  const { message, code } = failure as { message?: string; code?: string };
  return message || code || "unknown error";
}
