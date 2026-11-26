import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, it } from "vitest";
import { markMapped } from "../src/test-repository/mapped-knowledge.ts";
import { fixtureConfig } from "../src/fixture-repository.ts";

const workspace = mkdtempSync(join(tmpdir(), "oqas-mapped-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

describe("a test repository marked mapped", () => {
  it("has a card for each source the cartography reads in the first environment, and a knowledge base", () => {
    const root = mkdtempSync(join(workspace, "repo-"));
    const config = JSON.parse(fixtureConfig("http://127.0.0.1:9/v1", "http://127.0.0.1:9/")) as { applications: object[]; knowledge: object[] };
    const web = {
      id: "store",
      name: "Store",
      type: "web",
      authentication: { method: "none" },
      environments: [{ name: "local", uiUrl: "http://127.0.0.1:9/" }],
    };
    const knowledge = [
      ...config.knowledge,
      { id: "guides", type: "document", path: "specs", attachments: [{ application: "shop" }] },
      { id: "server-log", type: "logs", path: "server.log", attachments: [{ application: "shop" }] },
    ];
    writeFileSync(join(root, "oqas.json"), JSON.stringify({ ...config, applications: [...config.applications, web], knowledge }));
    markMapped(root);
    // A source attached to no environment is read in each; the database is attached to the second alone, and logs are not mapped.
    assert.deepEqual(readdirSync(join(root, ".oqas", "knowledge", "sources")).sort(), ["guides.json", "order-specs.json", "store.json"]);
    assert.ok(existsSync(join(root, ".oqas", "knowledge", "knowledge-base.json")));
  });
});
