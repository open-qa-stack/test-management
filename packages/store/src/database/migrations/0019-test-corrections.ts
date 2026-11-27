import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/** Adds to the decisions of the review the session that corrects a test a person asked to correct; their words are its note. */
async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable("test_decisions").addColumn("session", "text").execute();
}

/** The nineteenth migration: the corrections of the tests to review. */
export const testCorrections: Migration = { up };
