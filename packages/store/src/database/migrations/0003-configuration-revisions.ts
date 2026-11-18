import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/**
 * Creates the table of the revisions of the configuration of the instance, each under its number: the whole
 * document, its date, its origin and the digest of the file it was read from or wrote.
 */
async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable("configuration_revisions")
    .addColumn("number", "integer", (column) => column.primaryKey().notNull())
    .addColumn("recorded_at", "timestamptz(3)", (column) => column.notNull())
    .addColumn("origin", "text", (column) => column.notNull())
    .addColumn("file_digest", "text", (column) => column.notNull())
    .addColumn("document", "json", (column) => column.notNull())
    .execute();
}

/** The third migration: the configuration of an instance, kept in its database. */
export const configurationRevisions: Migration = { up };
