import assert from "node:assert/strict";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, it } from "vitest";
import { engineUnderTest } from "../support/database-engine.ts";
import { SessionDatabase } from "../support/session-database.ts";
import type { SelectType } from "kysely";
import type { StoreSchema } from "../../src/database/schema.ts";
import type { StoredBoolean, StoredInstant, StoredJson } from "../../src/database/stored-values.ts";

/** What a column of the schema keeps, whatever the database. */
type Kept<Column> =
  NonNullable<Column> extends StoredBoolean
    ? "boolean"
    : NonNullable<Column> extends StoredInstant
      ? "instant"
      : NonNullable<Column> extends StoredJson<unknown>
        ? "json"
        : NonNullable<Column> extends number
          ? "integer"
          : "text";

/** A column of the schema as the tests name it: what it keeps, and whether it may be empty. */
type Declared<Column> = null extends SelectType<Column> ? `${Kept<Column>}, or nothing` : Kept<Column>;

/**
 * The tables and the columns of the type of the schema, written out: the type has nothing left when the tests
 * run. The compiler refuses this listing as soon as it differs from the type — a table or a column that one
 * has and not the other, what a column keeps, whether it may be empty.
 */
const DECLARED: { readonly [Table in keyof StoreSchema]: { readonly [Column in keyof StoreSchema[Table]]: Declared<StoreSchema[Table][Column]> } } = {
  project: { only: "boolean", name: "text, or nothing", applications: "json" },
  sessions: {
    id: "text",
    request: "text, or nothing",
    environment: "text, or nothing",
    opened_at: "instant",
    last_event_at: "instant",
    state: "text",
    result: "json, or nothing",
    host: "text, or nothing",
    host_seen_at: "instant, or nothing",
    interruption_requested_at: "instant, or nothing",
  },
  session_events: { session_id: "text", id: "integer", at: "instant", type: "text", payload: "json" },
  session_messages: {
    session_id: "text",
    number: "integer",
    at: "instant",
    text: "text",
    delivered_to: "text, or nothing",
    delivered_at: "instant, or nothing",
  },
  configuration_revisions: { number: "integer", recorded_at: "instant", origin: "text", file_digest: "text", document: "json" },
  knowledge_documents: { source: "text", name: "text", uploaded_at: "instant", bytes: "integer", text: "text" },
  executions: { id: "text", origin: "text", session_id: "text, or nothing", ran_at: "instant", commit_sha: "text, or nothing", report: "text" },
  execution_results: {
    execution_id: "text",
    position: "integer",
    path: "text",
    title: "text",
    project: "text",
    verdict: "text",
    duration_ms: "integer",
    file_digest: "text, or nothing",
    failed_step: "integer, or nothing",
    failed_step_title: "text, or nothing",
    error_message: "text, or nothing",
    expected: "text, or nothing",
    received: "text, or nothing",
  },
};

/** The type each database gives a column for what it keeps, as its catalog names it. */
const STORED = {
  postgres: { text: "text", integer: "int4", boolean: "bool", instant: "timestamptz", json: "json" },
  sqlite: { text: "TEXT", integer: "INTEGER", boolean: "boolean", instant: "timestamptz(3)", json: "json" },
} as const;

const engine = engineUnderTest();

let sessions: SessionDatabase;
beforeAll(async () => {
  sessions = await SessionDatabase.create(engine);
});
afterAll(() => sessions.drop());

describe("a database the migrations brought to the last of them", () => {
  it("holds the tables and the columns the type of the schema describes, and no other", async () => {
    const stored = STORED[engine.name];
    const expected = Object.fromEntries(
      Object.entries(DECLARED).map(([table, columns]) => [
        table,
        Object.fromEntries(
          Object.entries(columns).map(([column, declared]) => {
            const [kept, nullable] = declared.split(", ") as [keyof typeof stored, string | undefined];
            return [column, `${stored[kept]}${nullable === undefined ? "" : ", or nothing"}`];
          }),
        ),
      ]),
    );
    const found = Object.fromEntries(
      (await sessions.database.kysely.introspection.getTables()).map(({ name, columns }) => [
        name,
        Object.fromEntries(columns.map((column) => [column.name, `${column.dataType}${column.isNullable ? ", or nothing" : ""}`])),
      ]),
    );
    assert.deepEqual(found, expected);
  });

  it("holds the project to one row: a second one is refused, under the same key and under another", async () => {
    const { kysely } = sessions.database;
    await sessions.store.saveProject({ name: "shop-tests", applications: [] });
    await assert.rejects(kysely.insertInto("project").values({ applications: "[]" }).execute(), /project/);
    await assert.rejects(sql`insert into project ("only", applications) values (false, '[]')`.execute(kysely), /project_only_one/);
    assert.deepEqual(await sessions.store.project(), { name: "shop-tests", applications: [] });
  });

  it("keeps an event and a message under their session and their rank, and with a session that exists alone", async () => {
    const { kysely } = sessions.database;
    const at = "2026-11-14T09:00:00.000Z";
    await kysely.insertInto("sessions").values({ id: "s1", opened_at: at, last_event_at: at, state: "queued" }).execute();
    const event = { session_id: "s1", id: 1, at, type: "note", payload: "{}" } as const;
    const message = { session_id: "s1", number: 1, at, text: "One." };
    await kysely.insertInto("session_events").values(event).execute();
    await kysely.insertInto("session_messages").values(message).execute();
    await assert.rejects(kysely.insertInto("session_events").values(event).execute(), /session_events/);
    await assert.rejects(kysely.insertInto("session_messages").values(message).execute(), /session_messages/);
    await assert.rejects(
      kysely
        .insertInto("session_events")
        .values({ ...event, session_id: "unknown" })
        .execute(),
      /foreign key/i,
    );
    await assert.rejects(
      kysely
        .insertInto("session_messages")
        .values({ ...message, session_id: "unknown" })
        .execute(),
      /foreign key/i,
    );
  });

  it("keeps a document once under its source and its name", async () => {
    const { kysely } = sessions.database;
    const document = { source: "specs", name: "quotes.md", uploaded_at: "2026-11-18T09:00:00.000Z", bytes: 1, text: "#" };
    await kysely.insertInto("knowledge_documents").values(document).execute();
    await kysely
      .insertInto("knowledge_documents")
      .values({ ...document, source: "notes" })
      .execute();
    await assert.rejects(kysely.insertInto("knowledge_documents").values(document).execute(), /knowledge_documents/);
  });
});
