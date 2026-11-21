import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/**
 * Creates the table of the memories of the agents, with an index on their domain and their kind, which every search
 * filters on. The notes an earlier version kept in a file of the state folder are not brought in.
 */
async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable("memories")
    .addColumn("id", "text", (column) => column.primaryKey().notNull())
    .addColumn("domain", "text", (column) => column.notNull())
    .addColumn("kind", "text", (column) => column.notNull())
    .addColumn("text", "text", (column) => column.notNull())
    .addColumn("tags", "json", (column) => column.notNull())
    .addColumn("source", "text")
    .addColumn("written_role", "text", (column) => column.notNull())
    .addColumn("written_task", "text", (column) => column.notNull())
    .addColumn("written_at", "timestamptz(3)", (column) => column.notNull())
    .addColumn("revised_role", "text")
    .addColumn("revised_task", "text")
    .addColumn("revised_at", "timestamptz(3)")
    .execute();
  await database.schema.createIndex("memories_domain_kind").on("memories").columns(["domain", "kind"]).execute();
}

/** The eleventh migration: the memories of the agents. */
export const memories: Migration = { up };
