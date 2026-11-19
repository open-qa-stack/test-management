import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import type { OqasConfig } from "@open-qa-stack/domain";
import { RepositoryTests } from "../src/index.ts";
import { MemoryConfigurationStore } from "./support/memory-configuration-store.ts";

/** A configuration whose applications are in the folder `suites`. */
const DOCUMENT = {
  formatVersion: 1,
  applications: [{ id: "shop", name: "Shop", type: "api", authentication: { method: "none" }, environments: [{ name: "local" }] }],
  repository: { appsDir: "suites" },
  model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:9/v1", model: "test-model" },
} as OqasConfig;

/** A test repository with one test of the shop, written by hand: a title, no step, and a tag that tells nothing. */
function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "oqas-repository-tests-"));
  mkdirSync(join(root, "suites", "shop"), { recursive: true });
  writeFileSync(join(root, "suites", "shop", "home.spec.ts"), 'test("The home page answers", { tag: ["@app-shop", "@slow"] }, async () => {});\n');
  return root;
}

describe("the tests of the test repository", () => {
  it("are read under the folder of the applications of the configuration in force, with what their tags say of them", async () => {
    const configuration = new MemoryConfigurationStore();
    await configuration.record({ origin: "file", fileDigest: "a1", document: DOCUMENT }, 0);
    assert.deepEqual(await new RepositoryTests(repository(), configuration).list(), [
      { path: "suites/shop/home.spec.ts", title: "The home page answers", steps: [], tags: ["@app-shop", "@slow"], applications: ["shop"] },
    ]);
  });

  it("are read under apps when the configuration names no folder of the applications", async () => {
    const configuration = new MemoryConfigurationStore();
    const { repository: _named, ...unnamed } = DOCUMENT;
    await configuration.record({ origin: "file", fileDigest: "a1", document: unnamed as OqasConfig }, 0);
    const root = repository();
    mkdirSync(join(root, "apps", "shop"), { recursive: true });
    writeFileSync(join(root, "apps", "shop", "orders.spec.ts"), 'test("Orders", async () => {});\n');
    assert.deepEqual(
      (await new RepositoryTests(root, configuration).list()).map((test) => test.path),
      ["apps/shop/orders.spec.ts"],
    );
  });

  it("are none without a test repository, or before a revision of the configuration is in force", async () => {
    const configuration = new MemoryConfigurationStore();
    assert.deepEqual(await new RepositoryTests(repository(), configuration).list(), []);
    await configuration.record({ origin: "file", fileDigest: "a1", document: DOCUMENT }, 0);
    assert.deepEqual(await new RepositoryTests(undefined, configuration).list(), []);
  });
});
