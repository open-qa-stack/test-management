import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/**
 * Creates the table of the defects a person reported from a test that failed, each under its number: what it is, how
 * serious, the test and the execution it comes from, and where it stands, with when it was reported, fixed and closed.
 */
async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable("defects")
    .addColumn("number", "integer", (column) => column.primaryKey().notNull())
    .addColumn("title", "text", (column) => column.notNull())
    .addColumn("severity", "text", (column) => column.notNull())
    .addColumn("description", "text", (column) => column.notNull())
    .addColumn("test_path", "text", (column) => column.notNull())
    .addColumn("test_title", "text", (column) => column.notNull())
    .addColumn("execution", "text")
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("opened_at", "text", (column) => column.notNull())
    .addColumn("fixed_at", "text")
    .addColumn("closed_at", "text")
    .execute();
}

/** The eighteenth migration: the defects. */
export const defects: Migration = { up };
