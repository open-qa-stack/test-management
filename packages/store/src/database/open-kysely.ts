import { Kysely, PostgresDialect, SqliteDialect } from "kysely";
import { postgresPool } from "./postgres/postgres-pool.ts";
import { openSqliteFile } from "./sqlite/open-sqlite-file.ts";
import type { StoreLogger } from "../store-logger.ts";
import type { DatabaseUrl } from "./database-url.ts";
import type { StoreSchema } from "./schema.ts";

/**
 * Builds the query builder of a database from its URL alone: this is the one place that knows which databases
 * the store supports. A database to support later is a dialect to name here, and to run the tests on.
 *
 * @param url - The connection URL of the database: a SQLite file, or a PostgreSQL server.
 * @param logger - Where a connection to a server dropped while idle is reported.
 * @returns The query builder, which opens nothing until a statement needs it.
 */
export function openKysely(url: DatabaseUrl, logger: StoreLogger): Kysely<StoreSchema> {
  const { file } = url;
  // The file is opened when a statement first needs it, and asked for again when that failed.
  const dialect =
    file === undefined ? new PostgresDialect({ pool: postgresPool(url, logger) }) : new SqliteDialect({ database: async () => openSqliteFile(file) });
  return new Kysely<StoreSchema>({ dialect });
}
