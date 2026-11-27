import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/**
 * Creates the table of the lessons the people of the project give the agents — what they must keep in mind, the
 * application it is kept to, the work it is for and whether it applies — and lets a person set a memory of the agents
 * aside: 1 in `disabled`, 0 otherwise, the same on both databases.
 */
async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable("lessons")
    .addColumn("id", "text", (column) => column.primaryKey().notNull())
    .addColumn("kind", "text", (column) => column.notNull())
    .addColumn("text", "text", (column) => column.notNull())
    .addColumn("application", "text")
    .addColumn("target", "text", (column) => column.notNull())
    .addColumn("active", "integer", (column) => column.notNull())
    .addColumn("written_at", "text", (column) => column.notNull())
    .addColumn("test", "text")
    .execute();
  await database.schema
    .alterTable("memories")
    .addColumn("disabled", "integer", (column) => column.notNull().defaultTo(0))
    .execute();
}

/** The twentieth migration: the lessons, and the memories set aside. */
export const lessons: Migration = { up };
