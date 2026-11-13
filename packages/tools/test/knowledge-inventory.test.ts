import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { Knowledge } from "@open-qa-stack/shared";
import { ALL_COLUMNS_QUERY, KEYS_QUERY, TABLES_QUERY } from "../src/postgresql/catalog-query.ts";
import { knowledgeInventory, type SqlClient, type SqlResult } from "../src/index.ts";
import { closedPort } from "@open-qa-stack/testing";
import { sqlResult } from "./sql-result.ts";
import { documentInventory } from "../src/document/document-inventory.ts";
import { CodeFolder } from "../src/source-code/code-folder.ts";
import { codeInventory } from "../src/source-code/code-inventory.ts";

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

  it("gives the chapters and sections of a document, numbered and leveled, a repeated title followed by its number", async () => {
    const document: Knowledge = { id: "specs", type: "document", path: "specs/quotes.md", attachments };
    const inventory = await knowledgeInventory(document, { repositoryRoot: REPOSITORY, env: {} });
    assert.deepEqual(inventory.items, ["Quotes", "Request a quote", "Answer a quote", "Policies"]);
    assert.deepEqual(inventory.facts.get("Answer a quote"), { number: 3, level: 2 });
    const twice = documentInventory("## Quotes\n### Rules\n#### Deep\n## Policies\n### Rules\n");
    assert.deepEqual(twice.items, ["Quotes", "Rules (§2)", "Policies", "Rules (§5)"]);
    assert.notEqual(twice.fingerprint, inventory.fingerprint);
  });

  it("gives the folders of source code with their files and routes, read by the grammars only", async () => {
    const code: Knowledge = { id: "policy-code", type: "source-code", path: "../source", attachments };
    const inventory = await knowledgeInventory(code, { repositoryRoot: REPOSITORY, env: {} });
    assert.deepEqual(inventory.items, ["src"]);
    const facts = inventory.facts.get("src") as { files: number; routes: string[] };
    assert.equal(facts.files, 2);
    assert.ok(facts.routes.length > 0);
  });

  it("merges the deepest folders of a large code base into their parent, skips unreadable files, and fingerprints the content", async () => {
    const root = mkdtempSync(join(tmpdir(), "oqas-code-inventory-"));
    try {
      const write = (path: string, text: string) => {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
      };
      write("main.ts", "export function main() {}\n");
      write("domain/policy/policy.ts", "export class Policy {}\n");
      write("domain/customer/customer.ts", "export class Customer {}\n");
      write("web/routes.js", "app.get('/policies', list);\n");
      write("web/binary.js", "\0");
      write("README.md", "# Not code\n");
      const folder = new CodeFolder(root);
      assert.deepEqual((await codeInventory(folder)).items, [".", "domain/customer", "domain/policy", "web"]);
      const merged = await codeInventory(folder, 3);
      assert.deepEqual(merged.items, [".", "domain", "web"]);
      assert.deepEqual(merged.facts.get("domain"), { files: 2, routes: [] });
      assert.deepEqual(merged.facts.get("web"), { files: 1, routes: ["app.get('/policies', …)"] });
      assert.deepEqual((await codeInventory(folder, 1)).items, ["."]);
      assert.equal((await codeInventory(folder)).truncated, undefined);
      assert.equal((await codeInventory(new CodeFolder(root, 2))).truncated, true);
      write("domain/policy/policy.ts", "export class Policy { id = 1 }\n");
      assert.notEqual((await codeInventory(folder, 3)).fingerprint, merged.fingerprint);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
