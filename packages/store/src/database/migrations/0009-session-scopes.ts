import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/** Keeps with a session what of the project it keeps its work to. The sessions asked for before keep the whole project. */
async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable("sessions").addColumn("scope", "json").execute();
}

/** The ninth migration: the scope of a session. */
export const sessionScopes: Migration = { up };
