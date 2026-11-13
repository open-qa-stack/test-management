import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { MIGRATIONS_FOLDER } from "../src/database/migrations-folder.ts";
import { runMigrations } from "../src/database/run-migrations.ts";
import { isolatedDatabase, type IsolatedDatabase } from "./support/isolated-database.ts";
import { jsonbColumnsWithoutGin, type JsonbColumn } from "./support/jsonb-columns-without-gin.ts";
import { JSONB_WITHOUT_GIN } from "./jsonb-without-gin.ts";

const FIXTURE = fileURLToPath(new URL("../../test/fixtures/migrations", import.meta.url));

async function withMigrated<T>(folder: string, read: (client: pg.Client) => Promise<T>): Promise<T> {
  const database = await isolatedDatabase();
  try {
    await runMigrations({ OQAS_DATABASE_URL: database.url }, folder);
    const client = new pg.Client({ connectionString: database.url });
    await client.connect();
    try {
      return await read(client);
    } finally {
      await client.end();
    }
  } finally {
    await database.drop();
  }
}

const key = ({ table, column }: JsonbColumn) => `${table}.${column}`;

describe("every JSONB column of the migrated schema", () => {
  it("has a GIN index, or a justified entry in the list of exceptions", async () => {
    const missing = await withMigrated(MIGRATIONS_FOLDER, jsonbColumnsWithoutGin);
    const excepted = new Set(JSONB_WITHOUT_GIN.map(key));
    assert.deepEqual(
      missing.map(key).filter((column) => !excepted.has(column)),
      [],
      "add a GIN index in the migration, or a justified exception",
    );
    assert.deepEqual(
      [...excepted].filter((column) => !missing.map(key).includes(column)),
      [],
      "remove the exceptions that no longer apply",
    );
    for (const exception of JSONB_WITHOUT_GIN) assert.ok(exception.reason.trim().length > 0, key(exception));
  });
});

describe("the catalog check of JSONB columns", () => {
  let database: IsolatedDatabase;
  before(async () => {
    database = await isolatedDatabase();
  });
  after(() => database.drop());

  it("finds a JSONB column without a GIN index, and passes one that has it", async () => {
    assert.deepEqual(await withMigrated(FIXTURE, jsonbColumnsWithoutGin), []);
    const client = new pg.Client({ connectionString: database.url });
    await client.connect();
    try {
      await client.query("create table events (id integer primary key, payload jsonb, details jsonb, labels jsonb)");
      await client.query("create index events_details on events using gin (details)");
      await client.query("create index events_labels on events using btree (labels)");
      assert.deepEqual(await jsonbColumnsWithoutGin(client), [
        { table: "public.events", column: "labels" },
        { table: "public.events", column: "payload" },
      ]);
    } finally {
      await client.end();
    }
  });
});
