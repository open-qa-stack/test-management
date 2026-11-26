import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/**
 * Creates the table of what a person decided of the tests the agents wrote, each under the identifier of its tag
 * `@oqas-id-…`: validated or set aside, when, and why for one set aside.
 */
async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable("test_decisions")
    .addColumn("id", "text", (column) => column.primaryKey().notNull())
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("decided_at", "text", (column) => column.notNull())
    .addColumn("reason", "text")
    .addColumn("covered_by", "text")
    .addColumn("note", "text")
    .execute();
}

/** The seventeenth migration: the decisions of the review. */
export const testDecisions: Migration = { up };
