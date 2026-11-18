import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/**
 * Gives a session its host: the process that hosts it, the date of the last beat of that process, and the
 * interruption another process asked for.
 *
 * @remarks
 * Several processes may reach one database, a terminal and a server among them, and the registry of the
 * executions that run is in the memory of each: the database is where they meet. The three columns are empty
 * on the sessions that were there before: a session without a beat reads as left by a host that died, which
 * is what a session an earlier version left running is.
 */
async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable("sessions").addColumn("host", "text").execute();
  await database.schema.alterTable("sessions").addColumn("host_seen_at", "timestamptz(3)").execute();
  await database.schema.alterTable("sessions").addColumn("interruption_requested_at", "timestamptz(3)").execute();
}

/** The second migration: the schema of an instance whose database several processes reach. */
export const sessionHosts: Migration = { up };
