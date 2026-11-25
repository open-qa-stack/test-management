import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/** Keeps with a campaign what a person says of it: what it is for, the version it tests, its days and who answers for it. The campaigns kept before say none. */
async function up(database: Kysely<unknown>): Promise<void> {
  for (const column of ["objective", "target_version", "starts_on", "ends_on", "owner"])
    await database.schema.alterTable("campaigns").addColumn(column, "text").execute();
}

/** The fifteenth migration: the details of a campaign. */
export const campaignDetails: Migration = { up };
