import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { InvalidDocumentsError, UnknownDocumentError, UnknownDocumentSourceError, type OqasConfig, type ReceivedFile } from "@open-qa-stack/domain";
import { KnowledgeDocuments } from "../src/index.ts";
import { MemoryConfigurationStore } from "./support/memory-configuration-store.ts";
import { MemoryDocumentStore } from "./support/memory-document-store.ts";

/** A configuration that declares a source of stored documents, `manuals`, and one of documents of the repository, `specs`. */
const DOCUMENT = {
  formatVersion: 1,
  applications: [{ id: "shop", name: "Shop", type: "api", authentication: { method: "none" }, environments: [{ name: "local" }] }],
  knowledge: [
    { id: "manuals", type: "document", stored: true, attachments: [{ application: "shop" }] },
    { id: "specs", type: "document", path: "specs", attachments: [{ application: "shop" }] },
  ],
  model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:9/v1", model: "test-model" },
} as OqasConfig;

/** A file of an upload, its content the UTF-8 of a text. */
const file = (name: string, text: string): ReceivedFile => {
  const content = new TextEncoder().encode(text);
  return { name, bytes: content.length, content };
};

/** The operations on documents, over a store kept in memory and a configuration that declares the sources of {@link DOCUMENT}. */
async function operations(declared = true): Promise<{ documents: KnowledgeDocuments; store: MemoryDocumentStore }> {
  const configuration = new MemoryConfigurationStore();
  if (declared) await configuration.record({ origin: "file", fileDigest: "a1", document: DOCUMENT }, 0);
  const store = new MemoryDocumentStore();
  return { documents: new KnowledgeDocuments(store, configuration), store };
}

describe("the operations on the documents of the knowledge sources", () => {
  it("upload documents to a source declared stored, list them by their names without their texts, and read one", async () => {
    const { documents } = await operations();
    await documents.upload("manuals", [file("quotes.md", "# Quotes\n"), file("claims.md", "# Claims\n")]);
    assert.deepEqual(await documents.list("manuals"), [
      { name: "claims.md", bytes: 9, uploadedAt: "2026-11-18T09:00:00.000Z" },
      { name: "quotes.md", bytes: 9, uploadedAt: "2026-11-18T09:00:00.000Z" },
    ]);
    assert.equal((await documents.read("manuals", "quotes.md")).text, "# Quotes\n");
  });

  it("replace a document of a name the source holds, and remove one", async () => {
    const { documents } = await operations();
    await documents.upload("manuals", [file("quotes.md", "# One\n")]);
    await documents.upload("manuals", [file("quotes.md", "# Two\n")]);
    assert.equal((await documents.read("manuals", "quotes.md")).text, "# Two\n");
    await documents.remove("manuals", "quotes.md");
    assert.deepEqual(await documents.list("manuals"), []);
  });

  it("refuse a document the source does not hold", async () => {
    const { documents } = await operations();
    await assert.rejects(documents.read("manuals", "quotes.md"), new UnknownDocumentError("manuals", "quotes.md"));
    await assert.rejects(documents.remove("manuals", "quotes.md"), new UnknownDocumentError("manuals", "quotes.md"));
  });

  it("refuse a source the revision in force does not declare stored, or with no revision at all", async () => {
    const { documents, store } = await operations();
    for (const source of ["specs", "unknown"]) {
      const refused = new UnknownDocumentSourceError(source);
      await assert.rejects(documents.list(source), refused);
      await assert.rejects(documents.read(source, "a.md"), refused);
      await assert.rejects(documents.upload(source, [file("a.md", "#")]), refused);
      await assert.rejects(documents.remove(source, "a.md"), refused);
    }
    assert.deepEqual(await store.list("specs"), []);
    await assert.rejects((await operations(false)).documents.list("manuals"), new UnknownDocumentSourceError("manuals"));
  });

  it("keep nothing of an upload one of whose files breaks a rule", async () => {
    const { documents } = await operations();
    await assert.rejects(
      documents.upload("manuals", [file("quotes.md", "# Quotes\n"), file("quotes.pdf", "%PDF")]),
      (error) => error instanceof InvalidDocumentsError && error.errors.map(({ path, rule }) => `${path} ${rule}`).join() === "/documents/1 document-format",
    );
    assert.deepEqual(await documents.list("manuals"), []);
  });
});
