import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/** Creates the table of what a person set of the domains of the knowledge. Whether a domain is excluded is 0 or 1, the same on both databases. */
async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable("domain_settings")
    .addColumn("id", "text", (column) => column.primaryKey().notNull())
    .addColumn("label", "text")
    .addColumn("excluded", "integer", (column) => column.notNull())
    .execute();
}

/** The sixteenth migration: the settings of the domains of the knowledge. */
export const domainSettings: Migration = { up };
