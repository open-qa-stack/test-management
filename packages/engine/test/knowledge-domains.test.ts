import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { DomainRefusedError, UnknownDomainError, type OqasConfig } from "@open-qa-stack/domain";
import { KnowledgeDomains } from "../src/index.ts";
import { MAX_DOMAIN_LABEL } from "../src/knowledge/knowledge-domains.ts";
import { MemoryDomainSettingStore } from "./support/memory-domain-setting-store.ts";
import { MemoryConfigurationStore } from "./support/memory-configuration-store.ts";

/** A configuration of two applications and a source of each, beside one of the whole project, whose index may be in a folder of its own. */
const DOCUMENT = {
  formatVersion: 1,
  applications: [
    { id: "shop", name: "Shop", type: "api", authentication: { method: "none" }, environments: [{ name: "local" }] },
    { id: "billing", name: "Billing", type: "api", authentication: { method: "none" }, environments: [{ name: "local" }] },
  ],
  knowledge: [
    { id: "orders-db", type: "postgresql", connectionStringEnv: "ORDERS_DB", attachments: [{ application: "shop" }] },
    { id: "invoices-api", type: "openapi", path: "invoices.yaml", attachments: [{ application: "billing" }] },
    { id: "glossary", type: "document", path: "docs" },
  ],
  model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:9/v1", model: "test-model" },
} as OqasConfig;

/** The sources of the orders: the screens of the shop, a source of each application and one of the whole project, each with what it holds of them. */
const ORDERS = [
  { id: "shop", type: "web", item: "/orders" },
  { id: "orders-db", type: "postgresql", item: "public.orders" },
  { id: "invoices-api", type: "openapi", item: "invoices" },
  { id: "glossary", type: "document", item: "Order" },
];

/** A knowledge base of two domains, the first of the sources of the orders, as the cartography writes it. */
const KNOWLEDGE_BASE = {
  formatVersion: 1,
  producedAt: "2026-11-20T09:00:00.000Z",
  environment: "local",
  model: { provider: "openai", baseUrl: "http://127.0.0.1:9/v1", model: "test-model" },
  run: { iterations: 1, actions: 0, durationMs: 1 },
  status: "complete",
  sources: ORDERS.map(({ id, type }) => ({ id, type, state: "read" })),
  domains: [
    {
      id: "orders",
      label: "Commandes",
      description: "Passer et suivre une commande.",
      references: ORDERS.map(({ id, item }) => ({ source: id, items: [item] })),
    },
    { id: "customers", label: "Clients", description: "Les clients de la boutique.", references: [{ source: "shop", items: ["/customers"] }] },
  ],
  unassigned: [],
};

/** A test repository whose index folder holds the text given. */
function repository(folder: string, text: string): string {
  const root = mkdtempSync(join(tmpdir(), "oqas-domains-"));
  mkdirSync(join(root, folder), { recursive: true });
  writeFileSync(join(root, folder, "knowledge-base.json"), text);
  return root;
}

/** The store of a configuration in force. */
async function configured(document: OqasConfig = DOCUMENT): Promise<MemoryConfigurationStore> {
  const configuration = new MemoryConfigurationStore();
  await configuration.record({ origin: "file", fileDigest: "a1", document }, 0);
  return configuration;
}

/** The domains of a test repository, with what a person set of them; nothing by default. */
const domainsOf = (root: string | undefined, configuration: MemoryConfigurationStore, settings = new MemoryDomainSettingStore()): KnowledgeDomains =>
  new KnowledgeDomains(root, configuration, settings);

describe("the domains of the knowledge", () => {
  it("are excluded, taken back and renamed, by what is kept apart from the knowledge base, which the cartography writes again", async () => {
    const root = repository(".oqas/knowledge", JSON.stringify(KNOWLEDGE_BASE));
    const settings = new MemoryDomainSettingStore();
    const domains = domainsOf(root, await configured(), settings);
    const told = async () => (await domains.list()).map(({ id, label, foundLabel, excluded }) => [id, label, foundLabel, excluded]);
    await domains.change("orders", { excluded: true });
    await domains.change("orders", { label: " Ventes " });
    const set = [
      ["orders", "Ventes", "Commandes", true],
      ["customers", "Clients", undefined, undefined],
    ];
    assert.deepEqual(await told(), set);
    writeFileSync(join(root, ".oqas/knowledge/knowledge-base.json"), JSON.stringify({ ...KNOWLEDGE_BASE, producedAt: "2026-11-21T09:00:00.000Z" }));
    await domains.forget();
    assert.deepEqual(await told(), set);
    assert.equal((await domains.change("orders", { excluded: false })).label, "Ventes");
    await domains.change("orders", { label: "Commandes" });
    assert.deepEqual(await settings.list(), [], "the name the cartography gave takes it back");
  });

  it("refuse a name that is empty or too long, and a domain the knowledge does not hold", async () => {
    const domains = domainsOf(repository(".oqas/knowledge", JSON.stringify(KNOWLEDGE_BASE)), await configured());
    for (const label of [" ", "x".repeat(MAX_DOMAIN_LABEL + 1)]) await assert.rejects(domains.change("orders", { label }), DomainRefusedError);
    await assert.rejects(domains.change("gone", { excluded: true }), UnknownDomainError);
  });

  it("take what was set of them away when the knowledge base no longer holds them, but not while it cannot be read", async () => {
    const root = repository(".oqas/knowledge", JSON.stringify(KNOWLEDGE_BASE));
    const settings = new MemoryDomainSettingStore();
    const domains = domainsOf(root, await configured(), settings);
    await domains.change("orders", { excluded: true });
    const write = (text: string) => writeFileSync(join(root, ".oqas/knowledge/knowledge-base.json"), text);
    write("{");
    await domains.forget();
    assert.equal((await settings.list()).length, 1);
    write(JSON.stringify({ ...KNOWLEDGE_BASE, domains: KNOWLEDGE_BASE.domains.slice(1) }));
    await domains.forget();
    assert.deepEqual(await settings.list(), []);
  });

  it("are those of the knowledge base the cartography wrote, in its order, each source with the applications the configuration attaches it to", async () => {
    assert.deepEqual(await domainsOf(repository(".oqas/knowledge", JSON.stringify(KNOWLEDGE_BASE)), await configured()).list(), [
      {
        id: "orders",
        label: "Commandes",
        description: "Passer et suivre une commande.",
        sources: [
          { id: "shop", applications: ["shop"], items: ["/orders"] },
          { id: "orders-db", applications: ["shop"], items: ["public.orders"] },
          { id: "invoices-api", applications: ["billing"], items: ["invoices"] },
          { id: "glossary", applications: [], items: ["Order"] },
        ],
      },
      {
        id: "customers",
        label: "Clients",
        description: "Les clients de la boutique.",
        sources: [{ id: "shop", applications: ["shop"], items: ["/customers"] }],
      },
    ]);
    const elsewhere = { ...DOCUMENT, repository: { knowledgeDir: "knowledge" } } as OqasConfig;
    assert.equal((await domainsOf(repository("knowledge", JSON.stringify(KNOWLEDGE_BASE)), await configured(elsewhere)).list()).length, 2);
  });

  it("are none without a test repository, a configuration, or a knowledge base that can be read and matches its schema", async () => {
    const root = repository(".oqas/knowledge", JSON.stringify(KNOWLEDGE_BASE));
    assert.deepEqual(await domainsOf(undefined, await configured()).list(), []);
    assert.deepEqual(await domainsOf(root, new MemoryConfigurationStore()).list(), []);
    assert.deepEqual(await domainsOf(mkdtempSync(join(tmpdir(), "oqas-domains-")), await configured()).list(), [], "no knowledge base yet");
    for (const text of ["", "{", JSON.stringify({ ...KNOWLEDGE_BASE, domains: [] })])
      assert.deepEqual(await domainsOf(repository(".oqas/knowledge", text), await configured()).list(), [], text);
  });
});
