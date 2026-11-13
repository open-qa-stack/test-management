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
  ],
  domains: [
    { id: "customers", label: "Customers", description: "Who buys at the shop.", references: [{ source: "shop-api", items: ["customers"] }, { source: "guide", items: ["Recherche d'un client"] }] },
    { id: "orders", label: "Orders", description: "Placing an order.", references: [{ source: "shop", items: ["/orders"] }, { source: "shop-api", items: ["customers", "customers"] }] },
  ],
  unassigned: [{ source: "archive", items: ["Old customer files"] }],
};

const CARD: SourceCard = {
  formatVersion: 1,
  source: { id: "shop-api", type: "openapi" },
  fingerprint: "f",
  producedAt: INDEX.producedAt,
  model: INDEX.model,
  run: INDEX.run,
  status: "complete",
  domains: [{ id: "customers", label: "Customers", description: "Customers.", items: [{ name: "customers", summary: "Finds a customer by name." }] }],
  unassigned: [],
};

const tool = (name: string): ToolDefinition => ({ name, description: name, parameters: { type: "object" }, execute: async () => "" });
// shop-logs is no source of the index: its tool is its own, not that of shop, whose prefix starts its name.
const map = new IndexMap(INDEX, new Map([["shop-api", CARD]]), ["shop_goto", "shop_api_list_operations", "shop_api_read_operation", "shop_logs_read_logs", "guide_read_section", "remember"].map(tool), ["shop", "shop-api", "shop-logs", "guide", "archive"]);
const [find, entry] = map.toolset() as [ToolDefinition, ToolDefinition];
const call = (definition: ToolDefinition, args: unknown) => definition.execute(args) as Promise<string | { error: string }>;

describe("the index as a map", () => {
  it("lists the domains in one line each", () => {
    assert.deepEqual(map.domains(), ["- customers (Customers): Who buys at the shop.", "- orders (Orders): Placing an order."]);
  });

  it("finds what echoes words, whatever the case, the accents and the plural, in the order of the index when they echo as much", async () => {
    const found = await call(find, { words: "CUSTOMER recherché" });
    assert.equal(
      found,
      [
        "Domains:",
        "- customers (Customers): Who buys at the shop.",
        "Elements:",
        "- shop-api: customers — Finds a customer by name.",
        "- guide: Recherche d'un client",
        "- archive: Old customer files",
        "Call index_entry with a domain, or with a source and an item, to know which tools read them.",
      ].join("\n"),
    );
  });

  it("matches a short word only whole, puts first what echoes most, and says when nothing echoes", async () => {
    assert.match(String(await call(find, { words: "cus" })), /^Nothing of the index echoes "cus"\. Try other words/);
    assert.match(String(await call(find, { words: "an" })), /^Domains:\n- orders \(Orders\): Placing an order\./);
    // The archive echoes two words, the guide one: the archive comes first, though the index places it last.
    assert.match(String(await call(find, { words: "old client files" })), /^Elements:\n- archive: Old customer files\n- guide: Recherche d'un client\n/);
    assert.equal(await call(find, { words: "a !" }), "Give at least one word of two letters or more.");
    assert.match(String(await call(find, { words: "orders" })), /^Domains:\n- orders \(Orders\): Placing an order\.\nElements:\n- shop: \/orders\n/);
  });

  it("gives a domain with each of its sources and the tools of each, the longest prefix owning a tool", async () => {
    assert.equal(
      await call(entry, { domain: "orders" }),
      ["orders (Orders): Placing an order.", "Source shop (web): read it with shop_goto.", "- shop: /orders", "Source shop-api (openapi): read it with shop_api_list_operations, shop_api_read_operation.", "- shop-api: customers — Finds a customer by name."].join("\n"),
    );
  });

  it("gives an element with its domains, or none for one the index left unassigned, and a source no tool reads", async () => {
    assert.match(String(await call(entry, { source: "shop-api", item: "customers" })), /Domains: customers, orders\.$/);
    assert.equal(await call(entry, { source: "archive", item: "Old customer files" }), ["Source archive (document): no tool of yours reads it.", "- archive: Old customer files", "Domains: none, the index left it unassigned."].join("\n"));
  });

  it("refuses an unknown domain, an element the index does not place, and a call without what to give", async () => {
    assert.deepEqual(await call(entry, { domain: "returns" }), { error: "No domain returns in the index; the domains are customers, orders." });
    assert.deepEqual(await call(entry, { source: "guide", item: "Returns" }), { error: "The index places no Returns in guide; index_find gives the elements it places." });
    assert.deepEqual(await call(entry, { source: "guide" }), { error: "Give a domain, or a source and an item." });
  });
});
