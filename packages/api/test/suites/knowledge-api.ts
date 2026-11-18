import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { Logger } from "@nestjs/common";
import { MAX_DOCUMENT_BYTES, MAX_DOCUMENTS_PER_UPLOAD } from "@open-qa-stack/domain";
import { SessionDatabase, type DatabaseEngine } from "@open-qa-stack/store/testing";
import { fixtureConfig } from "@open-qa-stack/testing/fixture-repository";
import { sessionsApi, type TestApi } from "../support/sessions-api.ts";
import type { DocumentList, Problem, StoredDocument } from "@open-qa-stack/domain/sessions";

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
  before(async () => {
    database = await SessionDatabase.create(engine, new Logger("Database"));
  });
  beforeEach(async () => {
    await database.clear();
    repository = mkdtempSync(join(tmpdir(), "oqas-api-knowledge-"));
    writeFileSync(join(repository, "oqas.json"), TEXT);
    api = await sessionsApi({ database: database.url, repository });
  });
  afterEach(async () => {
    await api.close();
    rmSync(repository, { recursive: true, force: true });
  });
  after(() => database.drop());

  const documents = (source = "manuals") => `${api.url}/knowledge/${encodeURIComponent(source)}/documents`;
  const get = async (path: string) => answerOf(await fetch(path));
  const upload = async (body: FormData, path = documents()) => answerOf(await fetch(path, { method: "POST", body }));
  const remove = async (path: string) => answerOf(await fetch(path, { method: "DELETE" }));
  const problemCode = (answer: Answer) => `${answer.status} ${(answer.body as Problem).code}`;
  const placed = (answer: Answer) => (answer.body as Problem).errors?.map(({ path, rule }) => `${path} ${rule}`);

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
}
