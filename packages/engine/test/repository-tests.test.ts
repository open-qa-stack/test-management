import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import type { OqasConfig } from "@open-qa-stack/domain";
import { RepositoryTests } from "../src/index.ts";
import { MemoryConfigurationStore } from "./support/memory-configuration-store.ts";
import { MemoryTestStore } from "./support/memory-test-store.ts";

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
    assert.deepEqual(await new RepositoryTests(repository(), configuration, new MemoryTestStore()).list(), [
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
      (await new RepositoryTests(root, configuration, new MemoryTestStore()).list()).map((test) => test.path),
      ["apps/shop/orders.spec.ts"],
    );
  });

  it("are none without a test repository, or before a revision of the configuration is in force", async () => {
    const configuration = new MemoryConfigurationStore();
    assert.deepEqual(await new RepositoryTests(repository(), configuration, new MemoryTestStore()).list(), []);
    await configuration.record({ origin: "file", fileDigest: "a1", document: DOCUMENT }, 0);
    assert.deepEqual(await new RepositoryTests(undefined, configuration, new MemoryTestStore()).list(), []);
  });

  it("are listed one per test, by its titles as the runner reports them, with what keeps a file from being listed as it is", async () => {
    const configuration = new MemoryConfigurationStore();
    await configuration.record({ origin: "file", fileDigest: "a1", document: DOCUMENT }, 0);
    const root = repository();
    const shop = join(root, "suites", "shop");
    writeFileSync(
      join(shop, "orders.spec.ts"),
      [
        'test.describe("Orders", () => {',
        '  test("List the orders", { tag: "@level-functional" }, async () => {',
        '    await test.step("1. Open the orders", async () => {});',
        "  });",
        '  test("Find an order", async () => {});',
        '  test("Find an order", async () => {});',
        "});",
      ].join("\n"),
    );
    writeFileSync(join(shop, "broken.spec.ts"), 'test("Broken", async () => {\n');
    writeFileSync(join(shop, "looped.spec.ts"), 'for (const name of ["a", "b"]) test(`Open ${name}`, async () => {});\n');
    const listed = await new RepositoryTests(root, configuration, new MemoryTestStore()).listed();
    assert.deepEqual(
      listed.items.map(({ path, title, steps, tags }) => [path.replace("suites/shop/", ""), title, steps, tags]),
      [
        ["broken.spec.ts", "Broken", [], []],
        ["home.spec.ts", "The home page answers", [], ["@app-shop", "@slow"]],
        ["looped.spec.ts", "suites/shop/looped.spec.ts", [], []],
        ["orders.spec.ts", "Orders › List the orders", ["1. Open the orders"], ["@level-functional"]],
        ["orders.spec.ts", "Orders › Find an order", [], []],
      ],
    );
    assert.deepEqual(listed.anomalies, [
      { kind: "unreadable", path: "suites/shop/broken.spec.ts" },
      { kind: "duplicate", path: "suites/shop/orders.spec.ts", title: "Orders › Find an order" },
    ]);
  });

  it("keep each test that bears an identifier under it, but an identifier two tests bear", async () => {
    const configuration = new MemoryConfigurationStore();
    await configuration.record({ origin: "file", fileDigest: "a1", document: DOCUMENT }, 0);
    const root = repository();
    const one = "3f0c2b9e-8d4a-4f1e-9b7a-2c5d6e7f8a90";
    const copied = "0b1c2d3e-4f50-4617-8899-aabbccddeeff";
    writeFileSync(
      join(root, "suites", "shop", "orders.spec.ts"),
      [
        `test("List the orders", { tag: ["@app-shop", "@oqas-id-${one}"] }, async () => {});`,
        `test("Find an order", { tag: "@oqas-id-${copied}" }, async () => {});`,
        `test("Find an order again", { tag: "@oqas-id-${copied}" }, async () => {});`,
      ].join("\n"),
    );
    const identities = new MemoryTestStore();
    const listed = await new RepositoryTests(root, configuration, identities).list();
    assert.deepEqual(
      listed.map(({ title, id }) => [title, id]),
      [
        ["The home page answers", undefined],
        ["List the orders", one],
        ["Find an order", copied],
        ["Find an order again", copied],
      ],
    );
    assert.deepEqual(identities.told, [[{ id: one, path: "suites/shop/orders.spec.ts", title: "List the orders" }]]);
  });
});
