import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/** The columns that say where a test failed and why, each empty when the report does not say it. */
const COLUMNS = [
  ["failed_step", "integer"],
  ["failed_step_title", "text"],
  ["error_message", "text"],
  ["expected", "text"],
  ["received", "text"],
] as const;

/**
 * Keeps with what came of a test in an execution where it failed and why: its step that failed, the first line of its
 * error, and what its assertion expected and received. The results kept before stay without them.
 */
async function up(database: Kysely<unknown>): Promise<void> {
  // One column at a time: SQLite adds no more to a table in one statement.
  for (const [name, type] of COLUMNS) await database.schema.alterTable("execution_results").addColumn(name, type).execute();
}

/** The sixth migration: where each test that failed in an execution failed, and why. */
export const executionFailures: Migration = { up };
