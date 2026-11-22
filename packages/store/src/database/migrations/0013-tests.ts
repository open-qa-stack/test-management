import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/**
 * Creates the table of the tests the instance knows by their identifier, the UUID of their tag `@oqas-id-…`, each with
 * where it is now: the path of its file and its titles, under which its versions and its results are kept.
 */
async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable("tests")
    .addColumn("id", "text", (column) => column.primaryKey().notNull())
    .addColumn("path", "text", (column) => column.notNull())
    .addColumn("title", "text", (column) => column.notNull())
    .execute();
}

/** The thirteenth migration: the tests under their identifier. */
export const tests: Migration = { up };
