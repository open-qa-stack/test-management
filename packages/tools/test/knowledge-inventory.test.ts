import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import type { Knowledge } from "@open-qa-stack/shared";
import {
  ALL_COLUMNS_QUERY,
  CONSTRAINTS_QUERY,
  INDEXES_QUERY,
  KEYS_QUERY,
  ROUTINES_QUERY,
  TABLES_QUERY,
  TRIGGERS_QUERY,
  VIEWS_QUERY,
} from "../src/postgresql/catalog-query.ts";
import { knowledgeInventory, type SqlClient, type SqlResult } from "../src/index.ts";
import { closedPort } from "@open-qa-stack/testing";
import { sqlResult } from "./sql-result.ts";
import { CodeFolder } from "../src/source-code/code-folder.ts";
import { codeInventory } from "../src/source-code/code-inventory.ts";

const REPOSITORY = fileURLToPath(new URL("./fixtures/repository/", import.meta.url));
const attachments = [{ application: "policy-management" }];

/** A catalog with two tables, two views, two routines and two triggers, whose columns and routines can be changed between reads. */
class CatalogDouble implements SqlClient {
  public premiumType = "numeric";
  public rate = "0.2";
  public readonly queries: string[] = [];

  /** {@inheritDoc SqlClient.query} */
  public async query(text: string): Promise<SqlResult> {
    this.queries.push(text);
    if (text === TABLES_QUERY)
      return sqlResult([
        { schema: "public", table: "policies" },
        { schema: "public", table: "audit" },
      ]);
    if (text === ALL_COLUMNS_QUERY) {
      return sqlResult([
        { schema: "public", table: "policies", name: "id", type: "bigint", nullable: false },
        { schema: "public", table: "policies", name: "premium", type: this.premiumType, nullable: true, default: "DEFAULT 0" },
        { schema: "public", table: "policies", name: "customer_id", type: "bigint", nullable: false },
        { schema: "public", table: "open_policies", name: "id", type: "bigint", nullable: true },
      ]);
    }
    if (text === CONSTRAINTS_QUERY)
      return sqlResult([{ schema: "public", table: "policies", name: "policies_premium_check", definition: "CHECK ((premium >= 0))" }]);
    if (text === INDEXES_QUERY) {
      return sqlResult([
        {
          schema: "public",
          table: "policies",
          name: "policies_customer_idx",
          definition: "CREATE INDEX policies_customer_idx ON public.policies USING btree (customer_id)",
        },
      ]);
    }
    if (text === VIEWS_QUERY) {
      return sqlResult([
        {
          schema: "public",
          view: "open_policies",
          materialized: false,
          definition: " SELECT id\n   FROM policies\n  WHERE premium IS NOT NULL;",
          columns: ["id"],
          reads: ["public.policies"],
        },
        { schema: "reporting", view: "premiums", materialized: true, definition: " SELECT 1 AS total;", columns: ["total"], reads: [] },
      ]);
    }
    if (text === KEYS_QUERY) {
      return sqlResult([
        { schema: "public", table: "policies", kind: "p", columns: ["id"], referenced_schema: null, referenced_table: null, referenced_columns: [] },
        {
          schema: "public",
          table: "policies",
          kind: "f",
          columns: ["customer_id"],
          referenced_schema: "public",
          referenced_table: "customers",
          referenced_columns: ["id"],
        },
      ]);
    }
    if (text === ROUTINES_QUERY) {
      return sqlResult([
        {
          schema: "public",
          name: "close_policy",
          arguments: "policy_id bigint",
          result: null,
          definition: "CREATE OR REPLACE PROCEDURE public.close_policy(IN policy_id bigint)\n LANGUAGE sql\nAS $procedure$ SELECT 1 $procedure$\n",
          parameters: ["policy_id"],
        },
        {
          schema: "public",
          name: "stamp",
          arguments: "",
          result: "trigger",
          definition: `CREATE OR REPLACE FUNCTION public.stamp()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$ BEGIN NEW.rate := ${this.rate}; RETURN NEW; END $function$\n`,
          parameters: [],
        },
      ]);
    }
    if (text === TRIGGERS_QUERY) {
      const stamp = { routine_schema: "public", routine_name: "stamp", routine_arguments: "" };
      return sqlResult([
        {
          schema: "public",
          table: "policies",
          name: "policies_stamp",
          definition: "CREATE TRIGGER policies_stamp BEFORE INSERT ON public.policies FOR EACH ROW EXECUTE FUNCTION stamp()",
          ...stamp,
        },
        {
          schema: "public",
          table: "open_policies",
          name: "open_policies_insert",
          definition: "CREATE TRIGGER open_policies_insert INSTEAD OF INSERT ON public.open_policies FOR EACH ROW EXECUTE FUNCTION stamp()",
          ...stamp,
        },
      ]);
    }
    throw new Error(`unexpected query ${text}`);
  }
}

describe("the inventory of a knowledge source, read without the model", () => {
  it("gives the operations of a contract, each with its identifier and its tags, keeps its schemas for the export, and fingerprints the export", async () => {
    const contract: Knowledge = { id: "policy-api", type: "openapi", path: "contracts/policies.json", attachments };
    const inventory = (await knowledgeInventory(contract, { repositoryRoot: REPOSITORY, env: {} }))!;
    assert.deepEqual(inventory.items, ["GET /policies", "POST /policies", "GET /policies/{id}"]);
    assert.deepEqual(Object.fromEntries(inventory.facts), {
      "GET /policies": { kind: "operation", operationId: "listPolicies", tags: ["policies"] },
      "POST /policies": { kind: "operation", operationId: "createPolicy", tags: ["policies"] },
      "GET /policies/{id}": { kind: "operation" },
    });
    assert.deepEqual(
      inventory.export!.elements.map((element) => [element.name, element.kind]),
      [
        ["GET /policies", "operation"],
        ["POST /policies", "operation"],
        ["GET /policies/{id}", "operation"],
        ["Policy", "schema"],
        ["Customer", "schema"],
      ],
    );
    // An operation holds the parameters of its path, the one it redefines once.
    assert.equal(
      inventory.export!.elements[2]!.summary,
      "operation GET /policies/{id} — Read a policy\n  parameters: id (path, required), fields (query)\n  responses: 200 Policy",
    );
    assert.deepEqual(inventory.export!.elements[2]!.links, ["Policy"]);
    assert.equal(inventory.fingerprint, inventory.export!.fingerprint);
    assert.equal((await knowledgeInventory(contract, { repositoryRoot: REPOSITORY, env: {} }))!.fingerprint, inventory.fingerprint);
  });

  it("gives the tables and the views of a base with their facts, keeps its routines for the export, and fingerprints its structure, from the catalog alone", async () => {
    const catalog = new CatalogDouble();
    const base: Knowledge = { id: "policy-db", type: "postgresql", connectionStringEnv: "DB", attachments };
    const access = { repositoryRoot: REPOSITORY, env: { DB: "postgresql://x" }, sqlClient: () => catalog };
    const inventory = (await knowledgeInventory(base, access))!;
    assert.deepEqual(inventory.items, ["public.policies", "public.audit", "public.open_policies", "reporting.premiums"]);
    assert.deepEqual(Object.fromEntries(inventory.facts), {
      "public.policies": {
        kind: "table",
        columns: 3,
        primaryKey: ["id"],
        foreignKeys: [{ columns: ["customer_id"], references: "public.customers", referencedColumns: ["id"] }],
        triggers: ["policies_stamp"],
      },
      "public.audit": { kind: "table", columns: 0, primaryKey: [], foreignKeys: [] },
      "public.open_policies": { kind: "view", columns: 1, reads: ["public.policies"], triggers: ["open_policies_insert"] },
      "reporting.premiums": { kind: "view", columns: 1, reads: [] },
    });
    assert.deepEqual(
      inventory.export!.elements.map((element) => [element.name, element.kind]),
      [
        ["public.policies", "table"],
        ["public.audit", "table"],
        ["public.open_policies", "view"],
        ["reporting.premiums", "view"],
        ["public.close_policy(policy_id bigint)", "routine"],
        ["public.stamp()", "routine"],
      ],
    );
    assert.deepEqual(
      inventory.export!.elements.slice(4).map((element) => [element.summary, element.names]),
      [
        ["procedure public.close_policy(policy_id bigint)", ["policy_id"]],
        ["function public.stamp() returns trigger", []],
      ],
    );
    assert.deepEqual(inventory.export!.elements[0]!.links, ["public.customers", "public.stamp()"]);
    assert.equal(
      inventory.export!.elements[0]!.definition,
      [
        "CREATE TABLE public.policies (",
        "  id bigint NOT NULL,",
        "  premium numeric DEFAULT 0,",
        "  customer_id bigint NOT NULL,",
        "  PRIMARY KEY (id),",
        "  FOREIGN KEY (customer_id) REFERENCES public.customers (id),",
        "  CONSTRAINT policies_premium_check CHECK ((premium >= 0))",
        ");",
        "",
        "CREATE INDEX policies_customer_idx ON public.policies USING btree (customer_id);",
        "",
        "CREATE TRIGGER policies_stamp BEFORE INSERT ON public.policies FOR EACH ROW EXECUTE FUNCTION stamp();",
      ].join("\n"),
    );
    assert.equal(
      inventory.export!.elements[2]!.definition,
      [
        "CREATE VIEW public.open_policies AS",
        " SELECT id",
        "   FROM policies",
        "  WHERE premium IS NOT NULL;",
        "",
        "CREATE TRIGGER open_policies_insert INSTEAD OF INSERT ON public.open_policies FOR EACH ROW EXECUTE FUNCTION stamp();",
      ].join("\n"),
    );
    assert.equal(inventory.fingerprint, inventory.export!.fingerprint);
    assert.deepEqual(
      catalog.queries.toSorted(),
      [ALL_COLUMNS_QUERY, CONSTRAINTS_QUERY, INDEXES_QUERY, KEYS_QUERY, ROUTINES_QUERY, TABLES_QUERY, TRIGGERS_QUERY, VIEWS_QUERY].toSorted(),
    );
    catalog.premiumType = "integer";
    assert.notEqual((await knowledgeInventory(base, access))!.fingerprint, inventory.fingerprint);
    catalog.premiumType = "numeric";
    assert.equal((await knowledgeInventory(base, access))!.fingerprint, inventory.fingerprint);
    catalog.rate = "0.3";
    assert.notEqual((await knowledgeInventory(base, access))!.fingerprint, inventory.fingerprint);
    assert.ok(catalog.queries.every((query) => /information_schema|pg_catalog/.test(query)));
  });

  it("reaches a base with PostgreSQL itself by default", async () => {
    const base: Knowledge = { id: "policy-db", type: "postgresql", connectionStringEnv: "DB", attachments };
    await assert.rejects(
      knowledgeInventory(base, { repositoryRoot: REPOSITORY, env: { DB: `postgresql://x@127.0.0.1:${await closedPort()}/x` } }),
      /ECONNREFUSED/,
    );
  });

  it("gives the documents of a source, one file or a folder of them, each with its title, its headings and its length, and fingerprints their texts", async () => {
    const document: Knowledge = { id: "specs", type: "document", path: "specs/quotes.md", attachments };
    const inventory = await knowledgeInventory(document, { repositoryRoot: REPOSITORY, env: {} });
    assert.deepEqual(inventory.items, ["quotes.md"]);
    assert.deepEqual(Object.fromEntries(inventory.facts), { "quotes.md": { title: "Quotes", headings: 4, chars: 267 } });
    // What an agent makes of the documents is its own to say: the harness exports nothing beforehand.
    assert.equal(inventory.export, undefined);
    const folder = await knowledgeInventory({ ...document, path: "specs" }, { repositoryRoot: REPOSITORY, env: {} });
    assert.deepEqual(folder.items, ["quotes.md"]);
    assert.match(folder.fingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.equal(folder.fingerprint, inventory.fingerprint);
    await assert.rejects(
      knowledgeInventory({ ...document, path: "specs/missing.md" }, { repositoryRoot: REPOSITORY, env: {} }),
      /The document specs\/missing\.md does not exist\./,
    );
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
