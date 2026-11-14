import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { ToolDefinition } from "@open-qa-stack/domain";
import type { Knowledge } from "@open-qa-stack/shared";
import {
  ALL_COLUMNS_QUERY,
  assertCatalogQuery,
  COLUMNS_QUERY,
  KEYS_QUERY,
  ROUTINES_QUERY,
  SERVER_ACCESS_QUERY,
  TABLES_QUERY,
  TRIGGERS_QUERY,
  VIEWS_QUERY,
} from "../src/postgresql/catalog-query.ts";
import { DatabaseCatalog } from "../src/postgresql/database-catalog.ts";
import { documentSections } from "../src/document/document-sections.ts";
import { PgSqlClient, type PgConnection } from "../src/postgresql/pg-sql-client.ts";
import { readRepositoryFile } from "../src/common/repository-file.ts";
import { closedPort } from "@open-qa-stack/testing";
import { knowledgeTools, type SqlClient, type SqlResult } from "../src/index.ts";
import { sqlResult } from "./sql-result.ts";

const REPOSITORY = fileURLToPath(new URL("./fixtures/repository/", import.meta.url));
const attachments = [{ application: "policy-management" }];
const CONTRACT: Knowledge = { id: "policy-api", type: "openapi", path: "contracts/policies.json", attachments };
const DOCUMENT: Knowledge = { id: "quote-specs", type: "document", path: "specs/quotes.md", attachments };
const DATABASE: Knowledge = { id: "policy-db", type: "postgresql", connectionStringEnv: "POLICY_DB_URL", attachments };

/** A SQL client that answers fixed rows and remembers every query. */
class RecordingSqlClient implements SqlClient {
  public readonly queries: string[] = [];

  /** {@inheritDoc SqlClient.query} */
  public async query(text: string): Promise<SqlResult> {
    this.queries.push(text);
    if (text === KEYS_QUERY) {
      return sqlResult([
        { schema: "public", table: "insurancepolicies", kind: "p", columns: ["id"], referenced_schema: null, referenced_table: null, referenced_columns: [] },
        {
          schema: "public",
          table: "insurancepolicies",
          kind: "f",
          columns: ["premium"],
          referenced_schema: "public",
          referenced_table: "prices",
          referenced_columns: ["amount"],
        },
        {
          schema: "public",
          table: "prices",
          kind: "f",
          columns: ["currency"],
          referenced_schema: "public",
          referenced_table: "currencies",
          referenced_columns: ["code"],
        },
      ]);
    }
    return sqlResult(
      text.includes("information_schema.tables")
        ? [{ schema: "public", table: "insurancepolicies" }]
        : [
            { name: "id", type: "bigint", nullable: false },
            { name: "premium", type: "numeric", nullable: true },
          ],
    );
  }
}

function tool(tools: ToolDefinition[], name: string): ToolDefinition {
  const found = tools.find((t) => t.name === name);
  assert.ok(found, name);
  return found;
}

describe("criterion 1 — each declared source brings its tools, and only its own", () => {
  it("gives a contract and a document their tools, and no database tool", () => {
    const tools = knowledgeTools([CONTRACT, DOCUMENT], { repositoryRoot: REPOSITORY, env: {} });
    assert.deepEqual(
      tools.map((t) => t.name),
      ["policy_api_list_operations", "policy_api_read_operation", "quote_specs_list_sections", "quote_specs_read_section"],
    );
    assert.ok(tools.every((t) => t.browserAction !== true));
  });
});

describe("criterion 2 — the contract tools read the operations of a contract", () => {
  it("lists the operations of a contract stored in the repository and reads one", async () => {
    const tools = knowledgeTools([CONTRACT], { repositoryRoot: REPOSITORY, env: {} });
    assert.deepEqual(await tool(tools, "policy_api_list_operations").execute({}), [
      { method: "GET", path: "/policies", operationId: "listPolicies", summary: "List policies", tags: ["policies"] },
      { method: "POST", path: "/policies", operationId: "createPolicy", tags: ["policies"] },
      { method: "GET", path: "/policies/{id}", summary: "Read a policy" },
    ]);
    const read = tool(tools, "policy_api_read_operation");
    assert.deepEqual(await read.execute({ method: "post", path: "/policies" }), {
      operationId: "createPolicy",
      responses: { "201": { description: "Created" } },
      tags: ["policies", 3, " "],
    });
    const one = (await read.execute({ method: "GET", path: "/policies/{id}" })) as {
      parameters: { name: string; description?: string }[];
      responses: Record<string, { content: Record<string, { schema: unknown }> }>;
    };
    assert.deepEqual(
      one.parameters.map((p) => [p.name, p.description]),
      [
        ["id", undefined],
        ["fields", "Fields to return"],
      ],
    );
    const schema = one.responses["200"]!.content["application/json"]!.schema as { properties: { owner: { properties: { name: unknown } } } };
    assert.deepEqual(schema.properties.owner.properties.name, { type: "string" });
    assert.ok(JSON.stringify(schema).includes('"$ref"'), "a recursive schema stops at the depth limit");
    assert.deepEqual(await read.execute({ method: "parameters", path: "/policies/{id}" }), {
      error: "The contract has no operation PARAMETERS /policies/{id}.",
    });
    assert.deepEqual(await read.execute({ method: "GET", path: "constructor" }), { error: "The contract has no operation GET constructor." });
    assert.deepEqual(await read.execute({ method: "DELETE", path: "/policies" }), { error: "The contract has no operation DELETE /policies." });
    assert.deepEqual(await read.execute({ method: "GET", path: "/claims" }), { error: "The contract has no operation GET /claims." });
  });

  it("refuses a contract that redirects elsewhere", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(302, { location: "http://127.0.0.1:9/elsewhere" });
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v3/api-docs`;
      const list = tool(
        knowledgeTools([{ id: "moved-api", type: "openapi", url, attachments }], { repositoryRoot: REPOSITORY, env: {} }),
        "moved_api_list_operations",
      );
      await assert.rejects(list.execute({}));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("reads a contract served at a URL once, and tries again after a failure", async () => {
    let requests = 0;
    const server = createServer((_req, res) => {
      requests++;
      res.writeHead(requests === 1 ? 503 : 200, { "content-type": "application/json" });
      res.end(requests === 1 ? "{}" : requests === 2 ? JSON.stringify({ openapi: "3.0.1" }) : "[]");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v3/api-docs`;
      const list = tool(
        knowledgeTools([{ id: "remote-api", type: "openapi", url, attachments }], { repositoryRoot: REPOSITORY, env: {} }),
        "remote_api_list_operations",
      );
      await assert.rejects(list.execute({}), /answered with status 503/);
      assert.deepEqual(await list.execute({}), []);
      assert.deepEqual(await list.execute({}), []);
      assert.equal(requests, 2);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("contracts that are not objects", () => {
  it("has no operation", async () => {
    const root = mkdtempSync(join(tmpdir(), "oqas-repo-"));
    try {
      writeFileSync(join(root, "contract.json"), "[]");
      const list = tool(knowledgeTools([{ ...CONTRACT, path: "contract.json" }], { repositoryRoot: root, env: {} }), "policy_api_list_operations");
      assert.deepEqual(await list.execute({}), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("criterion 3 — the catalog tools read the catalog and nothing else", () => {
  it("lists tables and columns with catalog queries only", async () => {
    const client = new RecordingSqlClient();
    const tools = knowledgeTools([DATABASE], { repositoryRoot: REPOSITORY, env: { POLICY_DB_URL: "postgresql://x" }, sqlClient: () => client });
    assert.deepEqual(await tool(tools, "policy_db_list_tables").execute({}), [{ schema: "public", table: "insurancepolicies" }]);
    assert.deepEqual(await tool(tools, "policy_db_describe_table").execute({ schema: "public", table: "insurancepolicies" }), [
      { name: "id", type: "bigint", nullable: false, primaryKey: true },
      { name: "premium", type: "numeric", nullable: true, references: "public.prices.amount" },
    ]);
    assert.deepEqual(
      [...(await new DatabaseCatalog(client).keys()).values()],
      [
        {
          table: "public.insurancepolicies",
          primaryKey: ["id"],
          foreignKeys: [{ columns: ["premium"], references: "public.prices", referencedColumns: ["amount"] }],
        },
        { table: "public.prices", primaryKey: [], foreignKeys: [{ columns: ["currency"], references: "public.currencies", referencedColumns: ["code"] }] },
      ],
    );
    assert.equal(client.queries.length, 4);
    for (const query of client.queries) assert.doesNotThrow(() => assertCatalogQuery(query));
  });

  it("allows the catalog queries and nothing else", () => {
    for (const query of [
      "SELECT * FROM insurancepolicies",
      "SELECT * FROM information_schema.tables, public.insurancepolicies",
      "SELECT pg_read_file('PG_VERSION')",
      `${TABLES_QUERY}; DROP TABLE insurancepolicies`,
      ` ${TABLES_QUERY}`,
    ]) {
      assert.throws(() => assertCatalogQuery(query), /Only the catalog queries/, query);
    }
    for (const query of [TABLES_QUERY, COLUMNS_QUERY, ALL_COLUMNS_QUERY, KEYS_QUERY, VIEWS_QUERY, ROUTINES_QUERY, TRIGGERS_QUERY, SERVER_ACCESS_QUERY])
      assert.doesNotThrow(() => assertCatalogQuery(query));
  });

  it("answers an error for a table the database does not have", async () => {
    const empty: SqlClient = { query: async () => sqlResult([]) };
    const describe = tool(
      knowledgeTools([DATABASE], { repositoryRoot: REPOSITORY, env: { POLICY_DB_URL: "postgresql://x" }, sqlClient: () => empty }),
      "policy_db_describe_table",
    );
    assert.deepEqual(await describe.execute({ schema: "public", table: "claims" }), { error: "The database policy-db has no table public.claims." });
    assert.deepEqual(await new DatabaseCatalog(empty).tables(), []);
  });

  it("runs each query alone, read-only, and always closes the connection", async () => {
    const log: string[] = [];
    const connection = (fail: boolean): PgConnection => ({
      connect: async () => {
        log.push("connect");
      },
      query: async (text: string) => {
        log.push(text);
        if (fail && text === TABLES_QUERY) throw new Error("boom");
        return text === TABLES_QUERY ? { rows: [{ a: 1 }], fields: [{ name: "a" }] } : { rows: [], fields: [] };
      },
      end: async () => {
        log.push("end");
      },
    });
    assert.deepEqual(await new PgSqlClient("postgresql://x", () => connection(false)).query(TABLES_QUERY, []), { columns: ["a"], rows: [{ a: 1 }] });
    assert.deepEqual(log, ["connect", "BEGIN READ ONLY", "SET LOCAL statement_timeout = 5000", TABLES_QUERY, "ROLLBACK", "end"]);
    log.length = 0;
    await assert.rejects(
      new PgSqlClient("postgresql://secret@x", () => connection(true)).query(TABLES_QUERY, []),
      new Error("The database query failed: boom."),
    );
    assert.deepEqual(log.at(-1), "end");
  });

  it("describes a driver error that has no message, without the connection string", async () => {
    const refusing = (failure: unknown): PgConnection => ({
      connect: () => Promise.reject(failure),
      query: async () => ({ rows: [], fields: [] }),
      end: async () => {},
    });
    await assert.rejects(
      new PgSqlClient("postgresql://user:pw@x", () => refusing(Object.assign(new Error(""), { code: "ECONNREFUSED" }))).query(TABLES_QUERY, []),
      new Error("The database query failed: ECONNREFUSED."),
    );
    await assert.rejects(
      new PgSqlClient("postgresql://user:pw@x", () => refusing("plain")).query(TABLES_QUERY, []),
      new Error("The database query failed: unknown error."),
    );
  });
});

describe("criterion 4 — a document tool never reads outside its declared file", () => {
  it("lists and reads sections of the declared document only, by number", async () => {
    const tools = knowledgeTools([DOCUMENT], { repositoryRoot: REPOSITORY, env: {} });
    assert.deepEqual(await tool(tools, "quote_specs_list_sections").execute({}), [
      { number: 1, level: 1, title: "Quotes" },
      { number: 2, level: 2, title: "Request a quote" },
      { number: 3, level: 2, title: "Answer a quote" },
      { number: 4, level: 1, title: "Policies" },
    ]);
    const read = tool(tools, "quote_specs_read_section");
    assert.equal(await read.execute({ number: 3 }), "## Answer a quote\n\nThe agent accepts or rejects it.");
    assert.deepEqual(await read.execute({ number: 9 }), { error: "The document has no section 9." });
    assert.deepEqual(Object.keys((read.parameters as { properties: object }).properties), ["number"]);
  });

  it("refuses a declared file that leads outside the repository through a link", async () => {
    const root = mkdtempSync(join(tmpdir(), "oqas-repo-"));
    const outside = mkdtempSync(join(tmpdir(), "oqas-outside-"));
    try {
      writeFileSync(join(outside, "secret.md"), "# Secret");
      symlinkSync(join(outside, "secret.md"), join(root, "specs.md"));
      const list = tool(knowledgeTools([{ ...DOCUMENT, path: "specs.md" }], { repositoryRoot: root, env: {} }), "quote_specs_list_sections");
      await assert.rejects(list.execute({}), /leads outside the test repository/);
      const self = tool(knowledgeTools([{ ...DOCUMENT, path: "." }], { repositoryRoot: root, env: {} }), "quote_specs_list_sections");
      await assert.rejects(self.execute({}), /leads outside the test repository/);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("ignores headings inside code blocks and text before the first heading", () => {
    assert.deepEqual(documentSections("intro\n  ```\n# not\n  ```\n# One ##\ntext\n## Learn C#"), [
      { number: 1, title: "One", level: 1, text: "# One ##\ntext\n## Learn C#" },
      { number: 2, title: "Learn C#", level: 2, text: "## Learn C#" },
    ]);
  });

  it("reads a file whose name starts with two dots", async () => {
    const root = mkdtempSync(join(tmpdir(), "oqas-repo-"));
    try {
      writeFileSync(join(root, "..notes.md"), "# Notes");
      assert.equal(await readRepositoryFile(root, "..notes.md"), "# Notes");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("criterion 5 — a source that cannot be reached fails the call, not the session", () => {
  it("turns an unreachable contract and a missing connection string into tool errors", async () => {
    const url = `http://127.0.0.1:${await closedPort()}/v3/api-docs`;
    const tools = knowledgeTools([{ id: "down-api", type: "openapi", url, attachments }, DATABASE], { repositoryRoot: REPOSITORY, env: { POLICY_DB_URL: "" } });
    await assert.rejects(tool(tools, "down_api_list_operations").execute({}), /fetch failed|ECONNREFUSED/);
    await assert.rejects(tool(tools, "policy_db_list_tables").execute({}), /POLICY_DB_URL is not set/);
  });

  it("reaches PostgreSQL by default, and reports a database that does not answer", async () => {
    const env = { POLICY_DB_URL: `postgresql://user:s3cret-pw@127.0.0.1:${await closedPort()}/policies` };
    const list = tool(knowledgeTools([DATABASE], { repositoryRoot: REPOSITORY, env }), "policy_db_list_tables");
    await assert.rejects(
      list.execute({}),
      (error: Error) => /^The database query failed: .*ECONNREFUSED/.test(error.message) && !error.message.includes("s3cret-pw"),
    );
  });
});
