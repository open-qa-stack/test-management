import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolDefinition } from "@open-qa-stack/domain";
import type { DomainIndex, SourceCard } from "@open-qa-stack/shared";
import { IndexMap } from "../src/designer/index-map.ts";

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
);
const [find, entry] = map.toolset() as [ToolDefinition, ToolDefinition];
const call = (definition: ToolDefinition, args: unknown) => definition.execute(args) as Promise<string | { error: string }>;

describe("the index as a map", () => {
  it("lists the domains in one line each", () => {
    assert.deepEqual(map.domains(), [
      "- customers (Customers): Who buys at the shop.",
      "- orders (Orders): Placing an order.",
      "- billing (Billing): Invoices.",
    ]);
  });

  it("finds what echoes words, whatever the case, the accents and the plural, in the order of the index when they echo as much", async () => {
    const found = await call(find, { words: "CUSTOMER recherché" });
    assert.equal(
      found,
      [
        "Domains:",
        "- customers (Customers): Who buys at the shop.",
        "Elements:",
        "- shop-api: customers — Finds a customer by name. (operations)",
        "- guide: Recherche d'un client (section)",
        "- archive: Old customer files (section)",
        "Call index_entry with a domain, or with a source and an item, to know what is known of them and which tools read them.",
      ].join("\n"),
    );
  });

  it("matches a short word only whole, puts first what echoes most, and says when nothing echoes", async () => {
    assert.match(String(await call(find, { words: "cus" })), /^Nothing of the index echoes "cus"\. Try other words/);
    assert.match(String(await call(find, { words: "an" })), /^Domains:\n- orders \(Orders\): Placing an order\./);
    // The archive echoes two words, the guide one: the archive comes first, though the index places it last.
    assert.match(
      String(await call(find, { words: "old client files" })),
      /^Elements:\n- archive: Old customer files \(section\)\n- guide: Recherche d'un client \(section\)\n/,
    );
    assert.equal(await call(find, { words: "a !" }), "Give at least one word of two letters or more.");
    assert.match(String(await call(find, { words: "orders" })), /^Domains:\n- orders \(Orders\): Placing an order\.\nElements:\n- shop: \/orders \(screen\)\n/);
  });

  it("gives a domain with each of its sources and the tools of each, the longest prefix owning a tool", async () => {
    assert.equal(
      await call(entry, { domain: "orders" }),
      [
        "orders (Orders): Placing an order.",
        "Source shop (web): read it with shop_goto.",
        "- shop: /orders (screen)",
        "Source shop-api (openapi): read it with shop_api_list_operations, shop_api_read_operation.",
        "- shop-api: customers — Finds a customer by name. (operations)",
      ].join("\n"),
    );
  });

  it("gives an element with its domains, or none for one the index left unassigned, and a source no tool reads", async () => {
    assert.match(
      String(await call(entry, { source: "shop-api", item: "customers" })),
      /\noperations: GET \/customers, GET \/customers\/\{id\}\nDomains: customers, orders\.$/,
    );
    assert.equal(
      await call(entry, { source: "archive", item: "Old customer files" }),
      ["Source archive (document): no tool of yours reads it.", "- archive: Old customer files (section)", "Domains: none, the index left it unassigned."].join(
        "\n",
      ),
    );
  });

  it("gives a table with its key fields, the facts of its card and the call that finds one of its rows", async () => {
    assert.equal(
      await call(entry, { source: "shop-db", item: "public.invoices" }),
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
      ].join("\n"),
    );
    // No tool of the agent searches the stock base: no call is given.
    assert.equal(
      await call(entry, { source: "stock-db", item: "public.items" }),
      ["Source stock-db (postgresql): no tool of yours reads it.", "- stock-db: public.items (table)", "Domains: none, the index left it unassigned."].join(
        "\n",
      ),
    );
  });

  it("finds an element by its key fields, and tells what the index holds for a text, or nothing", () => {
    assert.deepEqual(map.found("number"), ["Elements:", "- shop-db: public.invoices — An invoice sent to a client. (table)"]);
    assert.deepEqual(map.found("zebra"), []);
  });

  it("cuts an entry past sixty lines, and says how to read the rest", async () => {
    const items = Array.from({ length: 70 }, (_, i) => `/page-${i}`);
    const wide: DomainIndex = {
      ...INDEX,
      domains: [{ id: "pages", label: "Pages", description: "Every page.", references: [{ source: "shop", items }] }],
      unassigned: [],
    };
    const [, wideEntry] = new IndexMap(wide, new Map(), [], ["shop"]).toolset() as [ToolDefinition, ToolDefinition];
    const lines = String(await call(wideEntry, { domain: "pages" })).split("\n");
    assert.equal(lines.length, 60);
    assert.equal(lines.at(-1), "13 more lines; ask index_entry for one element at a time.");
  });

  it("refuses an unknown domain, an element the index does not place, and a call without what to give", async () => {
    assert.deepEqual(await call(entry, { domain: "returns" }), { error: "No domain returns in the index; the domains are customers, orders, billing." });
    assert.deepEqual(await call(entry, { source: "guide", item: "Returns" }), {
      error: "The index places no Returns in guide; index_find gives the elements it places.",
    });
    assert.deepEqual(await call(entry, { source: "guide" }), { error: "Give a domain, or a source and an item." });
  });
});
