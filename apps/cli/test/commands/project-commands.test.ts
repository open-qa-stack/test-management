import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, it } from "vitest";
import type { RevisionSummary } from "@open-qa-stack/domain";
import { fixtureConfig } from "@open-qa-stack/testing/fixture-repository";
import { runOqas } from "../../src/index.ts";

const workspace = mkdtempSync(join(tmpdir(), "oqas-project-commands-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

/** The configuration of the test repositories, with `manuals` a source whose documents the instance keeps. */
const TEXT = fixtureConfig("http://127.0.0.1:9/v1", "http://127.0.0.1:9/", {
  knowledge: [{ id: "manuals", type: "document", stored: true, attachments: [{ application: "shop" }] }],
});

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
    { id: "orders", label: "Orders", description: "Place and follow an order.", references: [{ source: "shop", items: ["/orders"] }] },
    { id: "customers", label: "Customers", description: "The customers of the shop.", references: [{ source: "shop", items: ["/customers"] }] },
  ],
  unassigned: [],
};

/** A test repository that holds a configuration file, the database of its instance kept beside it, and how to run oqas in it. */
function repository(text: string | undefined = TEXT) {
  const root = mkdtempSync(join(workspace, "repo-"));
  if (text !== undefined) writeFileSync(join(root, "oqas.json"), text);
  const env = { OQAS_DATABASE_URL: `sqlite:${join(workspace, `${root.split("/").at(-1)!}.db`)}` };
  const oqas = async (...argv: string[]) => {
    let out = "";
    let err = "";
    const code = await runOqas(argv, {
      env,
      cwd: root,
      stdout: { write: (written: string) => (out += written) },
      stderr: { write: (written: string) => (err += written) },
    });
    return { code, out, err };
  };
  return { root, oqas };
}

describe("oqas config history and check", () => {
  it("list the revisions, the latest first, and check oqas.json without taking it, each error where it is", async () => {
    const { root, oqas } = repository();
    assert.equal((await oqas("config", "history")).out, "The instance keeps no revision of the configuration.\n");
    assert.deepEqual(await oqas("config", "check"), { code: 0, out: "oqas.json is a valid configuration.\n", err: "" });
    await oqas("config", "import");
    assert.match((await oqas("config", "history")).out, /^Revision 1 of the configuration, taken from oqas\.json on \S+Z\.\n$/);
    assert.equal((JSON.parse((await oqas("config", "history", "--output", "json")).out) as { items: RevisionSummary[] }).items[0]?.number, 1);

    writeFileSync(join(root, "oqas.json"), JSON.stringify({ formatVersion: 1 }));
    const invalid = await oqas("config", "check");
    assert.equal(invalid.code, 3);
    assert.match(invalid.out, /^\/applications: Missing required key "applications"\.\n/);
    // What was checked is not taken: the revision in force is the same.
    assert.match((await oqas("config", "history")).out, /^Revision 1 /);
    // What is no object is wrong as a whole document.
    writeFileSync(join(root, "oqas.json"), "[]");
    assert.match((await oqas("config", "check")).out, /^\/: /);
    writeFileSync(join(root, "oqas.json"), "{");
    assert.match((await oqas("config", "check")).err, /^oqas\.json is no JSON: /);
    rmSync(join(root, "oqas.json"));
    assert.deepEqual(await oqas("config", "check"), { code: 3, out: "", err: "The test repository holds no oqas.json to check.\n" });
  });
});

describe("oqas project and oqas repository", () => {
  it("name the project and its applications, and tell where the test repository stands", async () => {
    const { root, oqas } = repository();
    await oqas("config", "import");
    assert.match((await oqas("project")).out, /^The project \S+\.\n {2}\S.* \(shop\)\n/);
    assert.deepEqual(await oqas("repository"), {
      code: 0,
      out: `The test repository is ${root}: it is no git repository, and no Playwright project yet: oqas --init prepares it.\n`,
      err: "",
    });
    writeFileSync(join(root, "playwright.config.ts"), "export default {};\n");
    assert.match((await oqas("repository")).out, /: it is no git repository, and a Playwright project\.\n$/);
    assert.deepEqual(await oqas("repository", "now"), {
      code: 3,
      out: "",
      err: "oqas repository takes nothing after it, and no --brief, --environment nor --follow.\n",
    });
  });
});

describe("oqas knowledge read, remove and domains", () => {
  it("print a document the instance keeps, remove it, and list the domains the cartography found", async () => {
    const { root, oqas } = repository();
    await oqas("config", "import");
    writeFileSync(join(root, "quotes.md"), "# Quotes\n\nA quote is valid for a month.\n");
    await oqas("knowledge", "add-document", "manuals", "quotes.md");
    assert.deepEqual(await oqas("knowledge", "read", "manuals", "quotes.md"), { code: 0, out: "# Quotes\n\nA quote is valid for a month.\n", err: "" });
    assert.deepEqual(await oqas("knowledge", "remove", "manuals", "quotes.md"), { code: 0, out: "The document quotes.md is removed from manuals.\n", err: "" });
    assert.equal((await oqas("knowledge", "read", "manuals", "quotes.md")).code, 3);
    assert.equal((await oqas("knowledge", "read", "nowhere", "quotes.md")).code, 3);

    assert.equal((await oqas("knowledge", "domains")).out, "The cartography found no domain yet: oqas knowledge mapping tells where it stands.\n");
    mkdirSync(join(root, ".oqas", "index"), { recursive: true });
    writeFileSync(join(root, ".oqas", "index", "domain-index.json"), JSON.stringify(INDEX));
    assert.deepEqual((await oqas("knowledge", "domains")).out.split("\n"), [
      "orders: Orders. Place and follow an order.",
      "customers: Customers. The customers of the shop.",
      "",
    ]);
    assert.equal((await oqas("knowledge", "exclude", "orders")).out, "orders: Orders. Place and follow an order. (excluded)\n");
    assert.equal((await oqas("knowledge", "rename", "orders", "Sales")).out, "orders: Sales. Place and follow an order. (excluded)\n");
    assert.equal((await oqas("knowledge", "restore", "orders")).out, "orders: Sales. Place and follow an order.\n");
    assert.deepEqual(await oqas("knowledge", "exclude", "gone"), { code: 3, out: "", err: "The knowledge has no domain gone.\n" });
    assert.equal((await oqas("knowledge", "rename", "orders")).code, 3);
  });
});
