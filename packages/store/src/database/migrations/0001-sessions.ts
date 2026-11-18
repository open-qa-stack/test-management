import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/**
 * Creates the tables of the project, of the sessions, of their events and of the messages sent to them.
 *
 * @remarks
 * The types are named once for every database. PostgreSQL has each of them. SQLite keeps the name and gives
 * the column no type of its own: it stores what it is given, the text of a date or of a JSON value, and 0 or 1
 * for a boolean. SQLite also takes an empty primary key unless the column says it is never empty.
 */
async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable("project")
    .addColumn("only", "boolean", (column) => column.primaryKey().notNull().defaultTo(true))
    .addColumn("name", "text")
    .addColumn("applications", "json", (column) => column.notNull())
    .addCheckConstraint("project_only_one", sql`${sql.ref("only")}`)
    .execute();
  await database.schema
    .createTable("sessions")
    .addColumn("id", "text", (column) => column.primaryKey().notNull())
    .addColumn("request", "text")
    .addColumn("environment", "text")
    .addColumn("opened_at", "timestamptz(3)", (column) => column.notNull())
    .addColumn("last_event_at", "timestamptz(3)", (column) => column.notNull())
    .addColumn("state", "text", (column) => column.notNull())
    .addColumn("result", "json")
    .execute();
  await database.schema
    .createTable("session_events")
    .addColumn("session_id", "text", (column) => column.notNull().references("sessions.id").onDelete("cascade"))
    .addColumn("id", "integer", (column) => column.notNull())
    .addColumn("at", "timestamptz(3)", (column) => column.notNull())
    .addColumn("type", "text", (column) => column.notNull())
    .addColumn("payload", "json", (column) => column.notNull())
    .addPrimaryKeyConstraint("session_events_pk", ["session_id", "id"])
    .execute();
  await database.schema
    .createTable("session_messages")
    .addColumn("session_id", "text", (column) => column.notNull().references("sessions.id").onDelete("cascade"))
    .addColumn("number", "integer", (column) => column.notNull())
    .addColumn("at", "timestamptz(3)", (column) => column.notNull())
    .addColumn("text", "text", (column) => column.notNull())
    .addColumn("delivered_to", "text")
    .addColumn("delivered_at", "timestamptz(3)")
    .addPrimaryKeyConstraint("session_messages_pk", ["session_id", "number"])
    .execute();
}

/** The first migration: the schema of an instance whose one process hosts its sessions. */
export const sessions: Migration = { up };
