import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { MAX_DOCUMENT_BYTES, MAX_DOCUMENTS_PER_UPLOAD } from "@open-qa-stack/domain";
import { SessionDatabase, type DatabaseEngine } from "@open-qa-stack/store/testing";
import { fixtureConfig } from "@open-qa-stack/testing/fixture-repository";
import { apiOverDatabase } from "../support/api-over-database.ts";
import { sessionsApi, type TestApi } from "../support/sessions-api.ts";
import type { DocumentList, KnowledgeDomain, KnowledgeDomainList, Problem, StoredDocument } from "@open-qa-stack/domain/sessions";

/** The configuration of the test repository: a source of documents the instance keeps, `manuals`, and one of documents of the repository, `order-specs`. */
const TEXT = fixtureConfig("http://127.0.0.1:9/v1", "http://127.0.0.1:9/", {
  knowledge: [
    { id: "manuals", type: "document", stored: true, attachments: [{ application: "shop" }] },
    { id: "order-specs", type: "document", path: "specs/orders.md", attachments: [{ application: "shop" }] },
  ],
});

/** An answer of the API: its status, its media type, its cache policy and its body, when it has one. */
interface Answer {
  readonly status: number;
  readonly type: string | null;
  readonly cache: string | null;
  readonly body: unknown;
}

async function answerOf(response: Response): Promise<Answer> {
  const text = await response.text();
  return {
    status: response.status,
    type: response.headers.get("content-type"),
    cache: response.headers.get("cache-control"),
    body: text === "" ? undefined : JSON.parse(text),
  };
}

/** A form of files, each a name and a text. */
function form(...files: readonly (readonly [name: string, text: string | Uint8Array])[]): FormData {
  const data = new FormData();
  for (const [name, text] of files) data.append("documents", new Blob([text]), name);
  return data;
}

/**
 * The tests of the routes of the documents of the knowledge sources over a database, written once for every
 * database the store supports.
 *
 * @param engine - The database to run them on.
 */
export function knowledgeApiSuite(engine: DatabaseEngine): void {
  let database: SessionDatabase;
  let repository: string;
  let api: TestApi;
  apiOverDatabase(engine, "knowledge", TEXT, (started) => {
    ({ api, repository, database } = started);
  });

  const documents = (source = "manuals") => `${api.url}/knowledge/${encodeURIComponent(source)}/documents`;
  const get = async (path: string) => answerOf(await fetch(path));
  const upload = async (body: FormData, path = documents()) => answerOf(await fetch(path, { method: "POST", body }));
  const remove = async (path: string) => answerOf(await fetch(path, { method: "DELETE" }));
  const problemCode = (answer: Answer) => `${answer.status} ${(answer.body as Problem).code}`;
  const placed = (answer: Answer) => (answer.body as Problem).errors?.map(({ path, rule }) => `${path} ${rule}`);

  describe(`the domains of the knowledge on ${engine.name}`, () => {
    it("are none before the cartography, then those of the index it wrote, which no cache may keep", async () => {
      await fetch(`${api.url}/project`);
      const domains = async () => {
        const response = await fetch(`${api.url}/knowledge/domains`);
        assert.equal(response.headers.get("cache-control"), "no-store");
        return ((await response.json()) as KnowledgeDomainList).items;
      };
      assert.deepEqual(await domains(), []);
      const index = {
        formatVersion: 1,
        producedAt: "2026-11-20T09:00:00.000Z",
        environment: "local",
        model: { provider: "openai", baseUrl: "http://127.0.0.1:9/v1", model: "test-model" },
        run: { iterations: 1, actions: 0, durationMs: 1 },
        status: "complete",
        sources: [{ id: "shop", type: "web", state: "read" }],
        domains: [{ id: "orders", label: "Commandes", description: "Passer une commande.", references: [{ source: "shop", items: ["/orders"] }] }],
        unassigned: [],
      };
      mkdirSync(join(repository, ".oqas", "index"), { recursive: true });
      writeFileSync(join(repository, ".oqas", "index", "domain-index.json"), JSON.stringify(index));
      assert.deepEqual(await domains(), [
        { id: "orders", label: "Commandes", description: "Passer une commande.", sources: [{ id: "shop", applications: ["shop"], items: ["/orders"] }] },
      ]);
      // A domain is renamed, excluded and taken back; what the cartography writes again keeps it.
      const change = async (id: string, body: unknown) => {
        const response = await fetch(`${api.url}/knowledge/domains/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        return { status: response.status, body: (await response.json()) as KnowledgeDomain & Problem };
      };
      const changed = await change("orders", { label: " Ventes ", excluded: true });
      assert.deepEqual([changed.status, changed.body.label, changed.body.foundLabel, changed.body.excluded], [200, "Ventes", "Commandes", true]);
      writeFileSync(join(repository, ".oqas", "index", "domain-index.json"), JSON.stringify({ ...index, producedAt: "2026-11-21T09:00:00.000Z" }));
      assert.deepEqual(
        (await domains()).map(({ label, excluded }) => [label, excluded]),
        [["Ventes", true]],
      );
      const opened = await fetch(`${api.url}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request: "Test", scope: { domains: ["orders"] } }),
      });
      assert.deepEqual([opened.status, ((await opened.json()) as Problem).code], [422, "domain_refused"]);
      assert.equal((await change("orders", { excluded: false, label: "Commandes" })).body.excluded, undefined);
      for (const [id, body, status, code] of [
        ["gone", { excluded: true }, 404, "unknown_domain"],
        ["orders", { label: " " }, 422, "domain_refused"],
        ["orders", {}, 400, "invalid_request"],
        ["orders", { label: 1 }, 400, "invalid_request"],
        ["orders", { excluded: "yes" }, 400, "invalid_request"],
      ] as const) {
        const refused = await change(id, body);
        assert.deepEqual([body, refused.status, refused.body.code], [body, status, code]);
      }
    });
  });

  describe(`the documents of a knowledge source on ${engine.name}`, () => {
    it("are none until some are uploaded, then listed by their names without their texts, and read one by one", async () => {
      const none = await get(documents());
      assert.deepEqual([none.status, none.type, none.cache, none.body], [200, "application/json; charset=utf-8", "no-store", { items: [] }]);
      const uploaded = await upload(form(["quotes.md", "# Quotes\n"], ["Claims é.md", "# Sinistres é\n"]));
      assert.equal(uploaded.status, 201);
      assert.deepEqual(
        (uploaded.body as DocumentList).items.map(({ name, bytes }) => `${name} ${bytes}`),
        ["Claims é.md 15", "quotes.md 9"],
      );
      assert.deepEqual((await get(documents())).body, uploaded.body);
      const read = await get(`${documents()}/${encodeURIComponent("Claims é.md")}`);
      assert.deepEqual([read.status, read.cache], [200, "no-store"]);
      const { name, text, bytes } = read.body as StoredDocument;
      assert.deepEqual([name, text, bytes], ["Claims é.md", "# Sinistres é\n", 15]);
    });

    it("replace the document of their name, and are removed one by one", async () => {
      await upload(form(["quotes.md", "# One\n"]));
      await upload(form(["quotes.md", "# Two, longer\n"]));
      assert.equal(((await get(`${documents()}/quotes.md`)).body as StoredDocument).text, "# Two, longer\n");
      const removed = await remove(`${documents()}/quotes.md`);
      assert.deepEqual([removed.status, removed.body], [204, undefined]);
      assert.equal(problemCode(await remove(`${documents()}/quotes.md`)), "404 unknown_document");
      assert.equal(problemCode(await get(`${documents()}/quotes.md`)), "404 unknown_document");
      assert.deepEqual((await get(documents())).body, { items: [] });
    });

    it("are refused all of an upload when one breaks a rule, each error at its document, and none is kept", async () => {
      const refused = await upload(form(["quotes.md", "# Quotes\n"], ["quotes.pdf", "%PDF"], ["image.md", new Uint8Array([0xff, 0xfe])]));
      assert.equal(problemCode(refused), "422 invalid_documents");
      assert.equal(refused.type, "application/problem+json; charset=utf-8");
      assert.deepEqual(placed(refused), ["/documents/1 document-format"]);
      const binary = await upload(form(["image.md", new Uint8Array([0xff, 0xfe])]));
      assert.deepEqual(placed(binary), ["/documents/0 document-encoding"]);
      assert.deepEqual((await get(documents())).body, { items: [] });
    });

    it("are read no further than the largest document and the most an upload holds", async () => {
      const largest = "a".repeat(MAX_DOCUMENT_BYTES);
      assert.equal((await upload(form(["largest.md", largest]))).status, 201);
      assert.deepEqual(placed(await upload(form(["larger.md", `${largest}a`]))), ["/documents/0 document-size"]);
      const many = (count: number) => form(...Array.from({ length: count }, (_, rank) => [`${rank}.md`, "#"] as const));
      assert.deepEqual(placed(await upload(many(MAX_DOCUMENTS_PER_UPLOAD + 1))), [" too-many-documents"]);
      assert.deepEqual(placed(await upload(many(MAX_DOCUMENTS_PER_UPLOAD + 3))), [" too-many-documents"]);
      assert.deepEqual(placed(await upload(new FormData())), [" no-documents"]);
      assert.deepEqual(
        ((await get(documents())).body as DocumentList).items.map(({ name }) => name),
        ["largest.md"],
      );
    });

    it("are uploaded as file parts of a multipart body only", async () => {
      const json = await answerOf(await fetch(documents(), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
      assert.equal(problemCode(json), "400 invalid_request");
      assert.match((json.body as Problem).detail, /multipart\/form-data, each one a file part/);
      const field = form(["quotes.md", "#"]);
      field.append("note", "more");
      assert.equal(problemCode(await upload(field)), "400 invalid_request");
      const cut = await answerOf(
        await fetch(documents(), {
          method: "POST",
          headers: { "content-type": "multipart/form-data; boundary=x" },
          body: '--x\r\ncontent-disposition: form-data; name="d"; filename="a.md"\r\n\r\n#',
        }),
      );
      assert.equal(problemCode(cut), "400 invalid_request");
    });

    it("belong to a source the configuration in force declares stored, and to no other", async () => {
      for (const source of ["order-specs", "shop-db", "unknown"]) {
        const refused = await get(documents(source));
        assert.equal(problemCode(refused), "404 unknown_document_source");
        assert.match((refused.body as Problem).detail, /"stored": true/);
        assert.equal(problemCode(await upload(form(["a.md", "#"]), documents(source))), "404 unknown_document_source");
      }
    });
  });

  describe(`the test of a knowledge source on ${engine.name}`, () => {
    const check = async (body: unknown, on = api) =>
      answerOf(await fetch(`${on.url}/knowledge/check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

    it("tells whether a source drafted answers, with what it holds, and never caches it", async () => {
      mkdirSync(join(repository, "docs"));
      writeFileSync(join(repository, "docs", "orders.md"), "# Orders\n");
      const answered = await check({ type: "document", path: "docs" });
      assert.deepEqual([answered.status, answered.cache, answered.body], [200, "no-store", { state: "ok", items: 1 }]);
      const failed = await check({ type: "postgresql", connectionStringEnv: "SHOP_DB_URL", value: "postgres://nobody@127.0.0.1:1/shop" });
      assert.equal((failed.body as { state: string }).state, "failed");
    });

    it("is refused for what is no source, a value that is no text, or by an API given no test repository", async () => {
      assert.equal(problemCode(await check({ type: "tickets" })), "400 invalid_request");
      assert.equal(problemCode(await check({ type: "postgresql", connectionStringEnv: "SHOP_DB_URL", value: 1 })), "400 invalid_request");
      assert.equal(problemCode(await check("docs")), "400 invalid_request");
      await api.close();
      api = await sessionsApi({ database: database.url });
      assert.equal(problemCode(await check({ type: "document", path: "docs" })), "503 unavailable");
    });
  });

  describe(`the knowledge mapped again on ${engine.name}`, () => {
    const remap = async (body?: unknown) =>
      answerOf(
        await fetch(`${api.url}/knowledge/mapping`, {
          method: "POST",
          ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
        }),
      );

    it("opens a session that maps a source again, and says when no such source is declared", async () => {
      assert.deepEqual(await remap({ source: "nowhere" }), {
        status: 200,
        type: "application/json; charset=utf-8",
        cache: null,
        body: { state: "unknown", source: "nowhere" },
      });
      const opened = await remap({ source: "order-specs" });
      const { state, session } = opened.body as { state: string; session: { purpose: string } };
      assert.deepEqual([opened.status, state, session.purpose], [200, "opened", "map"]);
    });

    it("maps every source again with an empty body, and is refused for a source that is no text, or by an API given no test repository", async () => {
      assert.equal(((await remap()).body as { state: string }).state, "opened");
      assert.equal(problemCode(await remap({ source: 1 })), "400 invalid_request");
      assert.equal(problemCode(await remap("order-specs")), "400 invalid_request");
      await api.close();
      api = await sessionsApi({ database: database.url });
      assert.equal(problemCode(await remap()), "503 unavailable");
    });
  });

  describe(`where the cartography stands on ${engine.name}`, () => {
    it("is each source the cartography reads, which waits while nothing mapped it, and no index yet, never cached", async () => {
      const read = await get(`${api.url}/knowledge/mapping`);
      assert.deepEqual([read.status, read.cache], [200, "no-store"]);
      const { environment, sources, index } = read.body as { environment: string; sources: { id: string; state: string }[]; index?: unknown };
      assert.equal(environment, "local");
      assert.ok(sources.length > 0 && sources.every(({ state }) => state === "waiting"), JSON.stringify(sources));
      assert.equal(index, undefined);
    });
  });
}
