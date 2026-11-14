import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolDefinition } from "@open-qa-stack/domain";
import type { DomainIndex, SourceCard, SourceManifest } from "@open-qa-stack/shared";
import { IndexMap, type WrittenSource } from "../src/designer/index-map.ts";

const INDEX: DomainIndex = {
  formatVersion: 1,
  producedAt: "2026-11-13T09:00:00.000Z",
  environment: "local",
  model: { provider: "openai", baseUrl: "http://127.0.0.1:1/v1", model: "m" },
  run: { iterations: 1, actions: 0, durationMs: 1 },
  status: "complete",
  sources: [
    { id: "shop", type: "web", state: "read" },
    { id: "shop-api", type: "openapi", state: "read" },
    { id: "guide", type: "document", state: "read" },
    { id: "archive", type: "document", state: "not_read" },
    { id: "shop-db", type: "postgresql", state: "read" },
    { id: "stock-db", type: "postgresql", state: "read" },
  ],
  domains: [
    {
      id: "customers",
      label: "Customers",
      description: "Who buys at the shop.",
      references: [
        { source: "shop-api", items: ["customers"] },
        { source: "guide", items: ["Recherche d'un client"] },
      ],
    },
    {
      id: "orders",
      label: "Orders",
      description: "Placing an order.",
      references: [
        { source: "shop", items: ["/orders"] },
        { source: "shop-api", items: ["customers", "customers"] },
      ],
    },
    { id: "billing", label: "Billing", description: "Invoices.", references: [{ source: "shop-db", items: ["public.invoices"] }] },
  ],
  unassigned: [
    { source: "archive", items: ["Old customer files"] },
    { source: "stock-db", items: ["public.items"] },
  ],
};

const CARD: SourceCard = {
  formatVersion: 1,
  source: { id: "shop-api", type: "openapi" },
  fingerprint: "f",
  producedAt: INDEX.producedAt,
  model: INDEX.model,
  run: INDEX.run,
  status: "complete",
  domains: [
    {
      id: "customers",
      label: "Customers",
      description: "Customers.",
      items: [{ name: "customers", summary: "Finds a customer by name.", facts: { operations: ["GET /customers", "GET /customers/{id}"] } }],
    },
  ],
  unassigned: [],
};

/** The card of a base: a table with its key fields and the keys the harness read. */
const BASE_CARD: SourceCard = {
  ...CARD,
  source: { id: "shop-db", type: "postgresql" },
  domains: [
    {
      id: "billing",
      label: "Billing",
      description: "Invoices.",
      items: [
        {
          name: "public.invoices",
          summary: "An invoice sent to a client.",
          keyFields: ["number", "client_name"],
          facts: {
            columns: 6,
            primaryKey: ["id"],
            foreignKeys: [{ columns: ["order_id"], references: "public.orders", referencedColumns: ["id"] }],
            notes: "kept ten years",
            indexes: [],
          },
        },
      ],
    },
  ],
};

/** What the workflow of the base wrote: its invoices are in its own domain `invoicing`, whose file names them. */
const MANIFEST: SourceManifest = {
  formatVersion: 1,
  source: { id: "shop-db", type: "postgresql" },
  fingerprint: "sha256:0",
  producedAt: INDEX.producedAt,
  status: "complete",
  domains: [{ id: "invoicing", label: "Invoicing", description: "Invoices.", file: "domains/invoicing.md", writtenBy: "model" }],
  elements: [
    { name: "public.invoices", kind: "table", fingerprint: "sha256:1", file: "export/tables/public.invoices.sql", domain: "invoicing", role: "An invoice." },
  ],
};
const INVOICING = "# Invoicing (`invoicing`)\n\n| Element | Role |\n|---|---|\n| `public.invoices` | An invoice sent to a client. |";
const DEFINITION = "CREATE TABLE public.invoices (\n  id bigint NOT NULL\n);";
const WRITTEN: WrittenSource = {
  manifest: MANIFEST,
  files: new Map([["invoicing", INVOICING]]),
  read: async (file) => (file === "export/tables/public.invoices.sql" ? DEFINITION : undefined),
};

const tool = (name: string): ToolDefinition => ({ name, description: name, parameters: { type: "object" }, execute: async () => "" });
// shop-logs is no source of the index: its tool is its own, not that of shop, whose prefix starts its name.
const map = new IndexMap(
  INDEX,
  new Map([
    ["shop-api", CARD],
    ["shop-db", BASE_CARD],
  ]),
  ["shop_goto", "shop_api_list_operations", "shop_api_read_operation", "shop_logs_read_logs", "guide_read_section", "shop_db_search", "remember"].map(tool),
  ["shop", "shop-api", "shop-logs", "guide", "archive", "shop-db", "stock-db"],
  new Map([["shop-db", WRITTEN]]),
);
const [domain, list, read] = map.toolset() as [ToolDefinition, ToolDefinition, ToolDefinition];
const call = (definition: ToolDefinition, args: unknown) => definition.execute(args) as Promise<string | { error: string }>;

/** Calls a tool that must answer with a text, and fails on the error it gives instead. */
async function answer(definition: ToolDefinition, args: unknown): Promise<string> {
  const result = await call(definition, args);
  if (typeof result !== "string") assert.fail(result.error);
  return result;
}

describe("the knowledge as a map", () => {
  it("lists the domains in one line each, with how many elements of each kind the sources hold of each", () => {
    assert.deepEqual(map.domains(), [
      "- customers (Customers): Who buys at the shop. 1 operations, 1 section.",
      "- orders (Orders): Placing an order. 1 operations, 1 screen.",
      "- billing (Billing): Invoices. 1 table.",
    ]);
    const empty = new IndexMap({ ...INDEX, domains: [{ ...INDEX.domains[2]!, references: [] }] }, new Map(), [], []);
    assert.deepEqual(empty.domains(), ["- billing (Billing): Invoices. No element yet."]);
  });

  it("gives a domain in short: its sources, what each holds of it and the tools that read each, the longest prefix owning a tool", async () => {
    assert.equal(
      await call(domain, { domain: "orders" }),
      [
        "orders (Orders): Placing an order.",
        "The sources that hold it:",
        "- Source shop (web): read it with shop_goto. It holds 1 screen.",
        "- Source shop-api (openapi): read it with shop_api_list_operations, shop_api_read_operation. It holds 1 operations.",
        "Call knowledge_domain with one of these sources for what it says of the domain, or knowledge_list with the domain for its elements.",
      ].join("\n"),
    );
  });

  it("gives what a source says of a domain: the files its workflow wrote, or the elements of its card", async () => {
    // The base wrote a file for its own domain that holds the invoices: it is given as it is.
    assert.equal(
      await call(domain, { domain: "billing", source: "shop-db" }),
      ["Source shop-db (postgresql): read it with shop_db_search.", "", INVOICING].join("\n"),
    );
    // A base whose manifest does not place the element, or whose file is lost, gives the elements of its card as well.
    const partial = (written: WrittenSource) =>
      new IndexMap(INDEX, new Map([["shop-db", BASE_CARD]]), [], [], new Map([["shop-db", written]]))
        .toolset()[0]!
        .execute({ domain: "billing", source: "shop-db" });
    const lines = ["Source shop-db (postgresql): no tool of yours reads it.", "", "- shop-db: public.invoices — An invoice sent to a client. (table)"].join(
      "\n",
    );
    assert.equal(await partial({ ...WRITTEN, files: new Map() }), lines);
    assert.equal(await partial({ ...WRITTEN, manifest: { ...MANIFEST, elements: [] } }), lines);
    // A source without such a file gives the elements its card places in the domain.
    assert.equal(
      await call(domain, { domain: "customers", source: "guide" }),
      ["Source guide (document): read it with guide_read_section.", "", "- guide: Recherche d'un client (section)"].join("\n"),
    );
  });

  it("refuses a domain the knowledge does not have, saying when it is a source, and a source that holds nothing of the domain", async () => {
    assert.deepEqual(await call(domain, { domain: "stock" }), { error: "stock is no domain of the knowledge; the domains are customers, orders, billing." });
    assert.deepEqual(await call(domain, { domain: "shop-db" }), { error: "shop-db is a source, not a domain; the domains are customers, orders, billing." });
    assert.deepEqual(await call(domain, { domain: "billing", source: "guide" }), {
      error: "guide holds nothing of the domain billing; its sources are shop-db.",
    });
  });

  it("lists the elements, a line each, narrowed by a kind, a domain or words, those that echo most first", async () => {
    assert.equal(
      await call(list, {}),
      [
        "1 operations, 2 sections, 1 screen, 2 tables:",
        "- shop-api: customers — Finds a customer by name. (operations)",
        "- guide: Recherche d'un client (section)",
        "- shop: /orders (screen)",
        "- shop-db: public.invoices — An invoice sent to a client. (table)",
        "- archive: Old customer files (section)",
        "- stock-db: public.items (table)",
        "Call knowledge_read with a source and an item for what is known of one.",
      ].join("\n"),
    );
    assert.match(await answer(list, { kind: "Tables" }), /^2 tables:\n- shop-db: public\.invoices .*\n- stock-db: public\.items \(table\)\n/);
    assert.match(await answer(list, { domain: "orders" }), /^1 operations, 1 screen:\n- shop-api: customers .*\n- shop: \/orders \(screen\)\n/);
    // Words match whatever the case, the accents and the plural; the archive echoes two words, the guide one.
    assert.match(await answer(list, { words: "CUSTOMER recherché" }), /^1 operations, 2 sections:\n- shop-api: customers /);
    assert.match(
      await answer(list, { words: "old client files" }),
      /^2 sections, 1 table:\n- archive: Old customer files \(section\)\n- guide: Recherche d'un client \(section\)\n/,
    );
    // An element is found by its key fields too.
    assert.match(await answer(list, { words: "number", kind: "table" }), /^1 table:\n- shop-db: public\.invoices /);
  });

  it("says when nothing matches, with the kinds of the knowledge, and refuses an unknown domain", async () => {
    assert.equal(
      await call(list, { words: "zebra" }),
      "Nothing of the knowledge matches. Its kinds are operations, section, screen, table. Try other words, or read the sources with their tools: the knowledge is a map, not a limit.",
    );
    assert.deepEqual(await call(list, { domain: "stock" }), { error: "stock is no domain of the knowledge; the domains are customers, orders, billing." });
  });

  it("cuts a long list, and says how to narrow it", async () => {
    const many = Array.from({ length: 45 }, (_, i) => `public.t${i}`);
    const wide = new IndexMap({ ...INDEX, unassigned: [{ source: "stock-db", items: many }] }, new Map(), [], []);
    const listed = (await wide.toolset()[1]!.execute({ kind: "table" })) as string;
    assert.equal(listed.split("\n").length, 43);
    assert.ok(listed.includes("\n6 more: narrow the list with a kind, a domain or words.\n"));
  });

  it("gives an element with its domains, or none for one the knowledge left unassigned, and a source no tool reads", async () => {
    assert.equal(
      await call(read, { source: "shop-api", item: "customers" }),
      [
        "Source shop-api (openapi): read it with shop_api_list_operations, shop_api_read_operation.",
        "- shop-api: customers — Finds a customer by name. (operations)",
        "operations: GET /customers, GET /customers/{id}",
        "Domains: customers, orders.",
      ].join("\n"),
    );
    assert.equal(
      await call(read, { source: "archive", item: "Old customer files" }),
      [
        "Source archive (document): no tool of yours reads it.",
        "- archive: Old customer files (section)",
        "Domains: none, the knowledge left it unassigned.",
      ].join("\n"),
    );
  });

  it("gives a table with its key fields, the facts of its card, the call that finds one of its rows, and its definition from its export", async () => {
    assert.equal(
      await call(read, { source: "shop-db", item: "public.invoices" }),
      [
        "Source shop-db (postgresql): read it with shop_db_search.",
        "- shop-db: public.invoices — An invoice sent to a client. (table)",
        "Key fields: number, client_name.",
        "columns: 6",
        "primaryKey: id",
        'foreignKeys: {"columns":["order_id"],"references":"public.orders","referencedColumns":["id"]}',
        "notes: kept ten years",
        "indexes: none",
        'Find a row: shop_db_search({ "schema": "public", "table": "invoices", "value": "<text>" })',
        "Domains: billing.",
        "Definition, from export/tables/public.invoices.sql:",
        DEFINITION,
      ].join("\n"),
    );
    // A table of a base the agent has no search tool of, and whose workflow wrote nothing, has neither the call nor a definition.
    assert.equal(
      await call(read, { source: "stock-db", item: "public.items" }),
      ["Source stock-db (postgresql): no tool of yours reads it.", "- stock-db: public.items (table)", "Domains: none, the knowledge left it unassigned."].join(
        "\n",
      ),
    );
  });

  it("takes the kind of an element from its card when the card says it, and leaves out a definition that cannot be read", async () => {
    const view: SourceCard = {
      ...BASE_CARD,
      domains: [{ ...BASE_CARD.domains[0]!, items: [{ name: "public.invoices", summary: "Invoices to pay.", facts: { kind: "view" } }] }],
    };
    const unread: WrittenSource = { ...WRITTEN, read: async () => undefined };
    const viewed = new IndexMap(INDEX, new Map([["shop-db", view]]), [], [], new Map([["shop-db", unread]]));
    assert.equal(
      await viewed.toolset()[2]!.execute({ source: "shop-db", item: "public.invoices" }),
      [
        "Source shop-db (postgresql): no tool of yours reads it.",
        "- shop-db: public.invoices — Invoices to pay. (view)",
        "kind: view",
        "Domains: billing.",
      ].join("\n"),
    );
    assert.match(String(await viewed.toolset()[1]!.execute({ kind: "view" })), /^1 view:\n/);
  });

  it("cuts a long file of a domain and a long definition, and says how to read the rest", async () => {
    const long: WrittenSource = { ...WRITTEN, files: new Map([["invoicing", "x".repeat(9000)]]), read: async () => "y".repeat(9000) };
    const cut = new IndexMap(INDEX, new Map([["shop-db", BASE_CARD]]), [], [], new Map([["shop-db", long]]));
    const [inDomain, , one] = cut.toolset();
    assert.ok(
      String(await inDomain!.execute({ domain: "billing", source: "shop-db" })).endsWith(
        "x\n… cut after 8000 characters; call knowledge_read on an element for the rest.",
      ),
    );
    assert.ok(
      String(await one!.execute({ source: "shop-db", item: "public.invoices" })).endsWith("y\n… cut after 8000 characters; read the source for the rest."),
    );
  });

  it("cuts what a source without a file says of a domain past sixty lines, and says how to read the rest", async () => {
    const many = Array.from({ length: 70 }, (_, i) => `public.t${i}`);
    const wide = new IndexMap(
      { ...INDEX, domains: [{ ...INDEX.domains[2]!, references: [{ source: "stock-db", items: many }] }], unassigned: [] },
      new Map(),
      [],
      [],
    );
    const said = String(await wide.toolset()[0]!.execute({ domain: "billing", source: "stock-db" })).split("\n");
    assert.deepEqual([said.length, said.at(-1)], [62, "11 more lines; ask knowledge_read for one element at a time."]);
  });

  it("refuses an element the knowledge does not place", async () => {
    assert.deepEqual(await call(read, { source: "guide", item: "Refunds" }), {
      error: "The knowledge places no Refunds in guide; knowledge_list gives the elements it places.",
    });
  });
});
