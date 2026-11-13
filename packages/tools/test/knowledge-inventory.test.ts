import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { Knowledge } from "@open-qa-stack/shared";
import { ALL_COLUMNS_QUERY, KEYS_QUERY, TABLES_QUERY } from "../src/postgresql/catalog-query.ts";
import { knowledgeInventory, type SqlClient, type SqlResult } from "../src/index.ts";
import { closedPort } from "@open-qa-stack/testing";
import { sqlResult } from "./sql-result.ts";

const REPOSITORY = fileURLToPath(new URL("./fixtures/repository/", import.meta.url));
const attachments = [{ application: "policy-management" }];

/** A catalog with two tables, whose columns can be changed between reads. */
class CatalogDouble implements SqlClient {
  public premiumType = "numeric";
  public readonly queries: string[] = [];

  /** {@inheritDoc SqlClient.query} */
  public async query(text: string): Promise<SqlResult> {
    this.queries.push(text);
    if (text === TABLES_QUERY) return sqlResult([{ schema: "public", table: "policies" }, { schema: "public", table: "audit" }]);
    if (text === ALL_COLUMNS_QUERY) {
      return sqlResult([
        { schema: "public", table: "policies", name: "id", type: "bigint", nullable: false },
        { schema: "public", table: "policies", name: "premium", type: this.premiumType, nullable: true },
        { schema: "public", table: "policies", name: "customer_id", type: "bigint", nullable: false },
      ]);
    }
    if (text === KEYS_QUERY) {
      return sqlResult([
        { schema: "public", table: "policies", kind: "p", columns: ["id"], referenced_schema: null, referenced_table: null, referenced_columns: [] },
        { schema: "public", table: "policies", kind: "f", columns: ["customer_id"], referenced_schema: "public", referenced_table: "customers", referenced_columns: ["id"] },
      ]);
    }
    throw new Error(`unexpected query ${text}`);
  }
}

describe("the inventory of a knowledge source, read without the model", () => {
  it("gives the tags of a contract, the first path segment of an untagged operation, their operations and a fingerprint", async () => {
    const contract: Knowledge = { id: "policy-api", type: "openapi", path: "contracts/policies.json", attachments };
    const inventory = (await knowledgeInventory(contract, { repositoryRoot: REPOSITORY, env: {} }))!;
    assert.deepEqual(inventory.items, ["policies", "/policies"]);
    assert.deepEqual(Object.fromEntries(inventory.facts), { policies: { operations: ["GET /policies", "POST /policies"] }, "/policies": { operations: ["GET /policies/{id}"] } });
    assert.match(inventory.fingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.equal((await knowledgeInventory(contract, { repositoryRoot: REPOSITORY, env: {} }))!.fingerprint, inventory.fingerprint);
  });

  it("gives the tables of a base with their columns and keys, from the catalog alone, and a fingerprint of its structure", async () => {
    const catalog = new CatalogDouble();
    const base: Knowledge = { id: "policy-db", type: "postgresql", connectionStringEnv: "DB", attachments };
    const access = { repositoryRoot: REPOSITORY, env: { DB: "postgresql://x" }, sqlClient: () => catalog };
    const inventory = (await knowledgeInventory(base, access))!;
    assert.deepEqual(inventory.items, ["public.policies", "public.audit"]);
    assert.deepEqual(Object.fromEntries(inventory.facts), {
      "public.policies": { columns: 3, primaryKey: ["id"], foreignKeys: [{ columns: ["customer_id"], references: "public.customers", referencedColumns: ["id"] }] },
      "public.audit": { columns: 0, primaryKey: [], foreignKeys: [] },
    });
    catalog.premiumType = "integer";
    assert.notEqual((await knowledgeInventory(base, access))!.fingerprint, inventory.fingerprint);
    assert.ok(catalog.queries.every((query) => /information_schema|pg_catalog/.test(query)));
  });

  it("reaches a base with PostgreSQL itself by default", async () => {
    const base: Knowledge = { id: "policy-db", type: "postgresql", connectionStringEnv: "DB", attachments };
    await assert.rejects(knowledgeInventory(base, { repositoryRoot: REPOSITORY, env: { DB: `postgresql://x@127.0.0.1:${await closedPort()}/x` } }), /ECONNREFUSED/);
  });

  it("has no inventory yet for a document", async () => {
    assert.equal(await knowledgeInventory({ id: "specs", type: "document", path: "specs/quotes.md", attachments }, { repositoryRoot: REPOSITORY, env: {} }), undefined);
  });
});
