import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import type { OqasConfig } from "@open-qa-stack/domain";
import { KnowledgeDomains } from "../src/index.ts";
import { MemoryConfigurationStore } from "./support/memory-configuration-store.ts";

/** A configuration of one application, whose index may be in a folder of its own. */
const DOCUMENT = {
  formatVersion: 1,
  applications: [{ id: "shop", name: "Shop", type: "api", authentication: { method: "none" }, environments: [{ name: "local" }] }],
  model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:9/v1", model: "test-model" },
} as OqasConfig;

/** A domain index of two domains, as the cartography writes it. */
const INDEX = {
  formatVersion: 1,
  producedAt: "2026-11-20T09:00:00.000Z",
  environment: "local",
  model: { provider: "openai", baseUrl: "http://127.0.0.1:9/v1", model: "test-model" },
  run: { iterations: 1, actions: 0, durationMs: 1 },
  status: "complete",
  sources: [{ id: "shop", type: "web", state: "read" }],
  domains: [
    { id: "orders", label: "Commandes", description: "Passer et suivre une commande.", references: [{ source: "shop", items: ["/orders"] }] },
    { id: "customers", label: "Clients", description: "Les clients de la boutique.", references: [{ source: "shop", items: ["/customers"] }] },
  ],
  unassigned: [],
};

/** A test repository whose index folder holds the text given. */
function repository(folder: string, text: string): string {
  const root = mkdtempSync(join(tmpdir(), "oqas-domains-"));
  mkdirSync(join(root, folder), { recursive: true });
  writeFileSync(join(root, folder, "domain-index.json"), text);
  return root;
}

/** The store of a configuration in force. */
async function configured(document: OqasConfig = DOCUMENT): Promise<MemoryConfigurationStore> {
  const configuration = new MemoryConfigurationStore();
  await configuration.record({ origin: "file", fileDigest: "a1", document }, 0);
  return configuration;
}

describe("the domains of the knowledge", () => {
  it("are those of the index the cartography wrote, in its order, without their references", async () => {
    assert.deepEqual(await new KnowledgeDomains(repository(".oqas/index", JSON.stringify(INDEX)), await configured()).list(), [
      { id: "orders", label: "Commandes", description: "Passer et suivre une commande." },
      { id: "customers", label: "Clients", description: "Les clients de la boutique." },
    ]);
    const elsewhere = { ...DOCUMENT, repository: { indexDir: "knowledge" } } as OqasConfig;
    assert.equal((await new KnowledgeDomains(repository("knowledge", JSON.stringify(INDEX)), await configured(elsewhere)).list()).length, 2);
  });

  it("are none without a test repository, a configuration, or an index that can be read and matches its schema", async () => {
    const root = repository(".oqas/index", JSON.stringify(INDEX));
    assert.deepEqual(await new KnowledgeDomains(undefined, await configured()).list(), []);
    assert.deepEqual(await new KnowledgeDomains(root, new MemoryConfigurationStore()).list(), []);
    assert.deepEqual(await new KnowledgeDomains(mkdtempSync(join(tmpdir(), "oqas-domains-")), await configured()).list(), [], "no index yet");
    for (const text of ["", "{", JSON.stringify({ ...INDEX, domains: [] })])
      assert.deepEqual(await new KnowledgeDomains(repository(".oqas/index", text), await configured()).list(), [], text);
  });
});
