import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/**
 * Creates the tables of the executions of tests and of what came of each test in them: a test is named by the path
 * of its file and its titles, and keeps the digest of its file, the version it ran at with the commit of its
 * execution. An execution a session ran stays when the session goes.
 */
async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable("executions")
    .addColumn("id", "text", (column) => column.primaryKey().notNull())
    .addColumn("origin", "text", (column) => column.notNull())
    .addColumn("session_id", "text", (column) => column.references("sessions.id").onDelete("set null"))
    .addColumn("ran_at", "timestamptz(3)", (column) => column.notNull())
    .addColumn("commit_sha", "text")
    .addColumn("report", "text", (column) => column.notNull())
    .execute();
  await database.schema
    .createTable("execution_results")
    .addColumn("execution_id", "text", (column) => column.notNull().references("executions.id").onDelete("cascade"))
    .addColumn("position", "integer", (column) => column.notNull())
    .addColumn("path", "text", (column) => column.notNull())
    .addColumn("title", "text", (column) => column.notNull())
    .addColumn("project", "text", (column) => column.notNull())
    .addColumn("verdict", "text", (column) => column.notNull())
    .addColumn("duration_ms", "integer", (column) => column.notNull())
    .addColumn("file_digest", "text")
    .addPrimaryKeyConstraint("execution_results_pk", ["execution_id", "position"])
    .execute();
}

/** The fifth migration: the executions of tests and their results, kept in the database of the instance. */
export const executions: Migration = { up };
