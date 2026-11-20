import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/**
 * Creates the tables of the campaigns and of the tests each one fixed when it became ready, and keeps with an
 * execution the campaign it was launched for. The executions kept before belong to none.
 */
async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable("campaigns")
    .addColumn("id", "text", (column) => column.primaryKey().notNull())
    .addColumn("name", "text", (column) => column.notNull())
    .addColumn("environment", "text", (column) => column.notNull())
    .addColumn("tags", "json", (column) => column.notNull())
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("created_at", "timestamptz(3)", (column) => column.notNull())
    .addColumn("ready_at", "timestamptz(3)")
    .addColumn("closed_at", "timestamptz(3)")
    .execute();
  await database.schema
    .createTable("campaign_tests")
    .addColumn("campaign_id", "text", (column) => column.notNull().references("campaigns.id").onDelete("cascade"))
    .addColumn("path", "text", (column) => column.notNull())
    .addColumn("title", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("campaign_tests_pk", ["campaign_id", "path", "title"])
    .execute();
  await database.schema
    .alterTable("executions")
    .addColumn("campaign_id", "text", (column) => column.references("campaigns.id"))
    .execute();
}

/** The eighth migration: the campaigns, their tests, and the campaign of an execution. */
export const campaigns: Migration = { up };
