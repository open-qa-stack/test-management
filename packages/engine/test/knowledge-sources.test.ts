import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, it } from "vitest";
import type { Knowledge } from "@open-qa-stack/domain";
import { KnowledgeSources, NoRepositoryError } from "../src/index.ts";
import { MemoryDocumentStore } from "./support/memory-document-store.ts";

const root = mkdtempSync(join(tmpdir(), "oqas-knowledge-sources-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
mkdirSync(join(root, "docs"));
writeFileSync(join(root, "docs", "orders.md"), "# Orders\n");
writeFileSync(join(root, "docs", "refunds.md"), "# Refunds\n");
mkdirSync(join(root, "src"));
writeFileSync(join(root, "src", "orders.ts"), "export const orders = [];\n");
writeFileSync(
  join(root, "openapi.json"),
  JSON.stringify({ openapi: "3.0.0", info: { title: "Shop", version: "1" }, paths: { "/orders": { get: { responses: { "200": { description: "ok" } } } } } }),
);

/** A source as the person drafts it: no identifier, no attachment yet. */
const draft = (source: Record<string, unknown>): Knowledge => ({ id: "", attachments: [], ...source }) as unknown as Knowledge;

/** The connection strings a database was opened with, once a query, and what it answers: an empty catalogue, or a refusal. */
function database(refused?: string) {
  const opened: string[] = [];
  return {
    opened,
    client: (connectionString: string) => {
      opened.push(connectionString);
      return { query: () => (refused === undefined ? Promise.resolve({ columns: [], rows: [] }) : Promise.reject(new Error(refused))) };
    },
  };
}

describe("the test of a knowledge source", () => {
  it("counts what a folder of documents, a folder of code and a contract hold", async () => {
    const sources = new KnowledgeSources(root, {}, new MemoryDocumentStore());
    assert.deepEqual(await sources.check(draft({ type: "document", path: "docs" })), { state: "ok", items: 2 });
    assert.deepEqual(await sources.check(draft({ type: "source-code", path: "src" })), { state: "ok", items: 1 });
    assert.deepEqual(await sources.check(draft({ type: "openapi", path: "openapi.json" })), { state: "ok", items: 1 });
  });

  it("says why a source does not answer, and what the error hides behind it", async () => {
    const sources = new KnowledgeSources(root, {}, new MemoryDocumentStore());
    const missing = await sources.check(draft({ type: "document", path: "nowhere" }));
    assert.equal(missing.state, "failed");
    const unreachable = await sources.check(draft({ type: "openapi", url: "http://127.0.0.1:9/openapi.json" }));
    assert.match(unreachable.state === "failed" ? unreachable.reason : "", /^fetch failed: ./);
  });

  it("opens a database with the connection string typed, or that of its variable, and reads its catalogue alone", async () => {
    const answered = database();
    const sources = new KnowledgeSources(
      root,
      { current: () => Promise.resolve({ SHOP_DB_URL: "postgres://env" }) },
      new MemoryDocumentStore(),
      answered.client,
    );
    const source = draft({ type: "postgresql", connectionStringEnv: "SHOP_DB_URL" });
    assert.deepEqual(await sources.check(source), { state: "ok", items: 0 });
    assert.deepEqual(await sources.check(source, "postgres://typed"), { state: "ok", items: 0 });
    assert.deepEqual([...new Set(answered.opened)], ["postgres://env", "postgres://typed"]);
    const closed = await new KnowledgeSources(root, {}, new MemoryDocumentStore()).check(source, "postgres://reader@127.0.0.1:1/shop");
    assert.equal(closed.state === "failed" ? closed.reason.split("ECONNREFUSED").length : 0, 2, "the cause is told once");
    const refused = new KnowledgeSources(root, {}, new MemoryDocumentStore(), database("password authentication failed").client);
    assert.deepEqual(await refused.check(source, "postgres://typed"), { state: "failed", reason: "password authentication failed" });
  });

  it("counts the documents the instance keeps, and does not test logs", async () => {
    const documents = new MemoryDocumentStore();
    await documents.put("manuals", [{ name: "quotes.md", text: "# Quotes\n" }]);
    const sources = new KnowledgeSources(undefined, {}, documents);
    assert.deepEqual(await sources.check(draft({ id: "manuals", type: "document", stored: true })), { state: "ok", items: 1 });
    assert.deepEqual(await sources.check(draft({ type: "logs", path: "server.log" })), { state: "unchecked" });
  });

  it("tests no source read in a test repository on a host that has none", async () => {
    await assert.rejects(new KnowledgeSources(undefined, {}, new MemoryDocumentStore()).check(draft({ type: "document", path: "docs" })), NoRepositoryError);
  });
});
