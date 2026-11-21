import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/** Keeps with a session what it does: `map` for one that maps the knowledge alone. The sessions asked for before test. */
async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable("sessions").addColumn("purpose", "text").execute();
}

/** The twelfth migration: the purpose of a session. */
export const sessionPurposes: Migration = { up };
