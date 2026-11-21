import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/**
 * Leaves the tags of the campaigns: a campaign is made of the tests chosen for it, which its tests hold from its
 * planning on. A campaign still planned keeps no test, and its tests are chosen again.
 */
async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable("campaigns").dropColumn("tags").execute();
}

/** The tenth migration: the tests of a campaign are chosen, not taken by tags. */
export const campaignSelections: Migration = { up };
