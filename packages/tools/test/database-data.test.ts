import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import type { ToolDefinition } from "@open-qa-stack/domain";
import type { Knowledge } from "@open-qa-stack/shared";
import { COLUMNS_QUERY, KEYS_QUERY, SERVER_ACCESS_QUERY, TABLES_QUERY } from "../src/postgresql/catalog-query.ts";
import { dataRows, MAX_VALUE_LENGTH } from "../src/postgresql/data-rows.ts";
import { PgSqlClient, type PgConnection } from "../src/postgresql/pg-sql-client.ts";
import { DEFAULT_ROWS, MAX_ROWS, rowLimit } from "../src/postgresql/read-query.ts";
import { shortTextColumns } from "../src/postgresql/sql-text.ts";
import { knowledgeTools, type SqlClient, type SqlResult } from "../src/index.ts";
import { sqlResult } from "./sql-result.ts";

const REPOSITORY = fileURLToPath(new URL("./fixtures/repository/", import.meta.url));
const DATABASE: Knowledge = { id: "policy-db", type: "postgresql", connectionStringEnv: "POLICY_DB_URL", attachments: [{ application: "policy-management" }] };

/** A database double: a catalog with two tables, one result for any other query, and every query remembered. */
class FakeDatabase implements SqlClient {
  public readonly queries: { text: string; values: readonly unknown[] }[] = [];
  private readonly serverAccess: boolean;
  private readonly data: SqlResult;

  /**
   * @param options - Whether the role can reach the server, and the result data queries return.
   */
  public constructor(options: { serverAccess?: boolean; data?: SqlResult } = {}) {
    this.serverAccess = options.serverAccess ?? false;
    this.data =
      options.data ??
      sqlResult([
        { id: "1", owner: "Max Mustermann" },
        { id: "2", owner: "Erika" },
      ]);
  }

  /** {@inheritDoc SqlClient.query} */
  public async query(text: string, values: readonly unknown[]): Promise<SqlResult> {
    this.queries.push({ text, values });
    if (text === TABLES_QUERY)
      return sqlResult([
        { schema: "public", table: "policies" },
        { schema: "public", table: "counters" },
      ]);
    if (text === COLUMNS_QUERY) {
      return sqlResult(
        values[1] === "policies"
          ? [
              { name: "id", type: "bigint", nullable: false },
              { name: "owner", type: "character varying", nullable: true },
              { name: 'Note "x"', type: "text", nullable: true },
            ]
          : [{ name: "n", type: "integer", nullable: false }],
      );
    }
    // The primary key of the policies is their owner, which the table does not list first.
    if (text === KEYS_QUERY) return sqlResult([{ schema: "public", table: "policies", kind: "p", columns: ["owner"] }]);
    if (text === SERVER_ACCESS_QUERY) return sqlResult([{ server_access: this.serverAccess }]);
    return text.endsWith(" LIMIT 0") ? sqlResult([], this.data.columns) : this.data;
  }

  /** The data queries, without the catalog ones. */
  public get dataQueries(): { text: string; values: readonly unknown[] }[] {
    return this.queries.filter((q) => ![TABLES_QUERY, COLUMNS_QUERY, KEYS_QUERY, SERVER_ACCESS_QUERY].includes(q.text));
  }
}

function tools(database: FakeDatabase): Map<string, ToolDefinition> {
  const all = knowledgeTools([DATABASE], { repositoryRoot: REPOSITORY, env: { POLICY_DB_URL: "postgresql://x" }, sqlClient: () => database });
  return new Map(all.map((t) => [t.name, t]));
}

describe("criterion 1 — a database brings its data tools next to its catalog tools", () => {
  it("offers five tools", () => {
    assert.deepEqual(
      [...tools(new FakeDatabase()).keys()],
      ["policy_db_list_tables", "policy_db_describe_table", "policy_db_sample_rows", "policy_db_search", "policy_db_query"],
    );
  });
});

/** The columns of the policies as a sample or a search reads them: the primary key first, then the others in their order. */
const POLICY_COLUMNS = `left("owner"::text, 301) AS "owner", left("id"::text, 301) AS "id", left("Note ""x"""::text, 301) AS "Note ""x"""`;

describe("criterion 2 — a sample returns the first rows of a known table, bounded", () => {
  it("returns the rows with their columns, and asks for one row more to tell whether others exist", async () => {
    const database = new FakeDatabase();
    const result = await tools(database).get("policy_db_sample_rows")!.execute({ schema: "public", table: "policies", limit: 1 });
    assert.deepEqual(result, { columns: ["id", "owner"], rows: [{ id: "1", owner: "Max Mustermann" }], moreRows: true, cutValues: false });
    assert.deepEqual(database.dataQueries, [{ text: `SELECT ${POLICY_COLUMNS} FROM "public"."policies" LIMIT 2`, values: [] }]);
  });

  it("names the columns of an empty table", async () => {
    const database = new FakeDatabase({ data: sqlResult([], ["id", "owner"]) });
    const result = await tools(database).get("policy_db_sample_rows")!.execute({ schema: "public", table: "policies" });
    assert.deepEqual(result, { columns: ["id", "owner"], rows: [], moreRows: false, cutValues: false });
  });

  it("refuses a table the catalog does not know, without reading anything", async () => {
    const database = new FakeDatabase();
    assert.deepEqual(await tools(database).get("policy_db_sample_rows")!.execute({ schema: "public", table: "policies; DROP" }), {
      error: "The database policy-db has no table public.policies; DROP.",
    });
    assert.deepEqual(database.dataQueries, []);
  });

  it("bounds the number of rows asked for", () => {
    assert.deepEqual([rowLimit(undefined), rowLimit(0), rowLimit(7), rowLimit(5000), rowLimit(2.5)], [DEFAULT_ROWS, 1, 7, MAX_ROWS, DEFAULT_ROWS]);
  });
});

describe("criterion 3 — a search finds a value in the text columns, as a parameter", () => {
  it("searches every text column, in any case, and keeps the value out of the query text", async () => {
    const database = new FakeDatabase();
    const value = "O'Brien'; DROP TABLE policies; --_%";
    await tools(database).get("policy_db_search")!.execute({ schema: "public", table: "policies", value });
    const [query] = database.dataQueries;
    assert.equal(
      query!.text,
      `SELECT ${POLICY_COLUMNS} FROM "public"."policies" WHERE "owner"::text ILIKE $1 ESCAPE '\\' OR "Note ""x"""::text ILIKE $1 ESCAPE '\\' LIMIT 21`,
    );
    assert.deepEqual(query!.values, ["%O'Brien'; DROP TABLE policies; --\\_\\%%"]);
  });

  it("answers a table without text column, or unknown, with an error", async () => {
    const database = new FakeDatabase();
    const search = tools(database).get("policy_db_search")!;
    assert.deepEqual(await search.execute({ schema: "public", table: "counters", value: "x" }), {
      error: "The table public.counters has no text column to search.",
    });
    assert.deepEqual(await search.execute({ schema: "audit", table: "policies", value: "x" }), {
      error: "The database policy-db has no table audit.policies.",
    });
    assert.deepEqual(database.dataQueries, []);
  });
});

describe("criterion 4 — a free query is a single read, bounded, and never on a role that reaches the server", () => {
  it("learns the columns of a read query, then reads them as short text, bounded", async () => {
    const database = new FakeDatabase({ data: sqlResult([{ owner: "Erika" }]) });
    const result = await tools(database).get("policy_db_query")!.execute({ sql: "  with p as (select * from policies) select owner from p;  ", limit: 5 });
    const subquery = "(with p as (select * from policies) select owner from p\n) AS agent_query";
    assert.deepEqual(database.dataQueries, [
      { text: `SELECT * FROM ${subquery} LIMIT 0`, values: [] },
      { text: `SELECT left("owner"::text, 301) AS "owner" FROM ${subquery} LIMIT 6`, values: [] },
    ]);
    assert.deepEqual(result, { columns: ["owner"], rows: [{ owner: "Erika" }], moreRows: false, cutValues: false });
  });

  it("closes the subquery on its own line, so that a line comment cannot hide the limit", async () => {
    const database = new FakeDatabase();
    await tools(database).get("policy_db_query")!.execute({ sql: "select g from generate_series(1, 1000) g) as q --" });
    assert.match(database.dataQueries.at(-1)!.text, /--\n\) AS agent_query LIMIT 21$/);
  });

  it("refuses anything but one read before it reaches the database", async () => {
    const database = new FakeDatabase();
    const query = tools(database).get("policy_db_query")!;
    for (const sql of ["DELETE FROM policies", "SELECT 1; DELETE FROM policies", "SELECT 'a;b'", "COPY policies TO STDOUT"]) {
      assert.deepEqual(await query.execute({ sql }), { error: "Only a single SELECT or WITH query, without semicolons, may run." }, sql);
    }
    assert.deepEqual(database.queries, []);
  });

  it("refuses a free query when the role of the connection can reach the server", async () => {
    const database = new FakeDatabase({ serverAccess: true });
    const result = (await tools(database).get("policy_db_query")!.execute({ sql: "SELECT pg_read_file('/etc/hostname')" })) as { error: string };
    assert.match(result.error, /can reach the server's files or programs/);
    assert.deepEqual(database.dataQueries, []);
  });

  it("refuses a query with two columns of the same name, before reading its rows", async () => {
    const database = new FakeDatabase({ data: sqlResult([], ["id", "id"]) });
    const result = await tools(database).get("policy_db_query")!.execute({ sql: "SELECT a.id, b.id FROM policies a, policies b" });
    assert.deepEqual(result, { error: "The query returns more than one column named id. Give each column its own name." });
    assert.equal(database.dataQueries.length, 1);
  });
});

describe("criterion 5 — a write through the free query fails, because the transaction is read-only", () => {
  it("returns the database's refusal, and never commits", async () => {
    const sent: string[] = [];
    const readOnlyDatabase: PgConnection = {
      connect: async () => {},
      query: async (text: string) => {
        sent.push(text);
        if (text.includes("nextval(")) throw new Error("cannot execute nextval() in a read-only transaction");
        if (text === SERVER_ACCESS_QUERY) return { rows: [{ server_access: false }], fields: [{ name: "server_access" }] };
        return { rows: [], fields: [] };
      },
      end: async () => {
        sent.push("end");
      },
    };
    const all = knowledgeTools([DATABASE], {
      repositoryRoot: REPOSITORY,
      env: { POLICY_DB_URL: "postgresql://x" },
      sqlClient: (url) => new PgSqlClient(url, () => readOnlyDatabase),
    });
    const query = all.find((t) => t.name === "policy_db_query")!;
    await assert.rejects(
      Promise.resolve(query.execute({ sql: "SELECT nextval('policy_ids')" })),
      new Error("The database query failed: cannot execute nextval() in a read-only transaction."),
    );
    assert.deepEqual(sent.slice(-4), [
      "BEGIN READ ONLY",
      "SET LOCAL statement_timeout = 5000",
      "SELECT * FROM (SELECT nextval('policy_ids')\n) AS agent_query LIMIT 0",
      "end",
    ]);
    assert.ok(!sent.includes("COMMIT"));
  });
});

describe("a free query that names a column or a table the database does not have", () => {
  it("fails with the tool that gives the exact names, and any other refusal as the database gave it", async () => {
    const failing = (failure: unknown): PgConnection => ({
      connect: async () => {},
      query: async (text: string) => {
        if (text === SERVER_ACCESS_QUERY) return { rows: [{ server_access: false }], fields: [{ name: "server_access" }] };
        if (text.includes("agent_query")) throw failure;
        return { rows: [], fields: [] };
      },
      end: async () => {},
    });
    const query = (failure: unknown) => {
      const all = knowledgeTools([DATABASE], {
        repositoryRoot: REPOSITORY,
        env: { POLICY_DB_URL: "postgresql://x" },
        sqlClient: (url) => new PgSqlClient(url, () => failing(failure)),
      });
      return Promise.resolve(all.find((t) => t.name === "policy_db_query")!.execute({ sql: "SELECT ownr FROM policies" }));
    };
    await assert.rejects(
      query(Object.assign(new Error('column "ownr" does not exist'), { code: "42703" })),
      new Error('The database query failed: column "ownr" does not exist. Call policy_db_describe_table for the exact names.'),
    );
    await assert.rejects(
      query(Object.assign(new Error('relation "policies" does not exist'), { code: "42P01" })),
      new Error('The database query failed: relation "policies" does not exist. Call policy_db_describe_table for the exact names.'),
    );
    await assert.rejects(
      query(Object.assign(new Error("syntax error at end of input"), { code: "42601" })),
      new Error("The database query failed: syntax error at end of input."),
    );
    await assert.rejects(query("plain"), new Error("The database query failed: unknown error."));
  });
});

describe("criterion 6 — long values are cut by the database, and the answer says so", () => {
  it("reads every column as text cut one character beyond the limit", () => {
    assert.equal(shortTextColumns(["a", 'b"c']), `left("a"::text, ${MAX_VALUE_LENGTH + 1}) AS "a", left("b""c"::text, ${MAX_VALUE_LENGTH + 1}) AS "b""c"`);
  });

  it("marks a value one character too long as cut, and leaves the others", () => {
    const limit = "y".repeat(MAX_VALUE_LENGTH);
    const result = dataRows(sqlResult([{ text: "x".repeat(MAX_VALUE_LENGTH + 1), full: limit, none: null }]), 10);
    assert.deepEqual(result, {
      columns: ["text", "full", "none"],
      rows: [{ text: `${"x".repeat(MAX_VALUE_LENGTH)}…`, full: limit, none: null }],
      moreRows: false,
      cutValues: true,
    });
    assert.deepEqual(dataRows(sqlResult([{ full: limit }]), 10).cutValues, false);
  });
});
