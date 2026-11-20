import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/**
 * Creates the table of the versions of the tests, each numbered from 1 under the path of its file and its titles,
 * with the digest of the test, the commit it was first run committed at, and when it was first run; and keeps with
 * what came of a test in an execution the digest of the test, whether it was committed, and its version. The results
 * kept before stay without them.
 */
async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable("test_versions")
    .addColumn("path", "text", (column) => column.notNull())
    .addColumn("title", "text", (column) => column.notNull())
    .addColumn("number", "integer", (column) => column.notNull())
    .addColumn("digest", "text", (column) => column.notNull())
    .addColumn("commit_sha", "text")
    .addColumn("since", "timestamptz(3)", (column) => column.notNull())
    .addPrimaryKeyConstraint("test_versions_pk", ["path", "title", "number"])
    .execute();
  // One column at a time: SQLite adds no more to a table in one statement. Whether the test was committed is 0 or 1,
  // the same on both databases.
  await database.schema.alterTable("execution_results").addColumn("test_digest", "text").execute();
  await database.schema.alterTable("execution_results").addColumn("committed", "integer").execute();
  await database.schema.alterTable("execution_results").addColumn("version", "integer").execute();
}

/** The seventh migration: the versions of the tests, and the one each result ran at. */
export const testVersions: Migration = { up };
