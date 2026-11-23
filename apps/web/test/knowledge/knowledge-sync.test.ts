import assert from "node:assert/strict";
import { MAX_DOCUMENT_BYTES } from "@open-qa-stack/domain/sessions";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { ApiClient } from "../../src/api/api-client.ts";
import type { KnowledgeAction } from "../../src/knowledge/knowledge-state.ts";
import { KnowledgeSync, READ_PAUSE_MS } from "../../src/knowledge/knowledge-sync.ts";
import { FakeDocument } from "../api/fake-document.ts";
import { VIEW } from "../configuration/configuration-fixture.ts";

/** What the instance does when called. */
type Answer = () => Response;

const json =
  (body: unknown, status = 200): Answer =>
  () =>
    new Response(status === 204 ? null : JSON.stringify(body), { status });

/** A document of the source `manuals` of the fixtures. */
const QUOTES = { name: "quotes.md", bytes: 9, uploadedAt: "2026-11-18T09:00:00.000Z" };

/** An instance a test plays, and the screens it tells. */
class PlayedApi {
  public readonly answers = new Map<string, Answer>();
  public readonly calls: string[] = [];
  public readonly told: KnowledgeAction[] = [];
  public readonly sync = new KnowledgeSync(
    new ApiClient(async (input, init) => {
      const call = `${init?.method ?? "GET"} ${input}`;
      this.calls.push(call);
      return this.answers.get(call)!();
    }),
    (action) => this.told.push(action),
  );
}

const settled = (): Promise<unknown> => vi.advanceTimersByTimeAsync(0);

/** Where the cartography of the knowledge stands: one source mapped, the index not written yet. */
const MAPPING = { environment: "local", sources: [{ id: "manuals", type: "document", state: "mapped", mappedAt: "2026-11-22T09:00:00.000Z" }] } as const;

describe("what keeps the screens of the knowledge in step with their instance", () => {
  let api = new PlayedApi();

  beforeEach(() => {
    api = new PlayedApi();
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("document", new FakeDocument());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reads the configuration in force and the documents of each source it keeps, again and again, and says when the instance cannot tell them", async () => {
    api.answers.set("GET /api/configuration", json(VIEW));
    api.answers.set("GET /api/knowledge/manuals/documents", json({ items: [QUOTES] }));
    api.answers.set("GET /api/knowledge/mapping", json(MAPPING));
    const stop = api.sync.read();
    await settled();
    assert.deepEqual(api.told, [
      { type: "mapped", mapping: MAPPING },
      { type: "read", view: VIEW },
      { type: "listed", source: "manuals", items: [QUOTES] },
    ]);
    api.answers.set("GET /api/configuration", json({ file: "missing" }));
    await vi.advanceTimersByTimeAsync(READ_PAUSE_MS);
    assert.deepEqual(api.told.at(-1), { type: "read", view: { file: "missing" } });
    api.answers.set("GET /api/configuration", json({ code: "unavailable", detail: "Down." }, 503));
    await vi.advanceTimersByTimeAsync(READ_PAUSE_MS);
    assert.deepEqual(api.told.at(-1), { type: "unread", message: "Aucune source de sessions n’est configurée sur cette instance." });
    stop();
  });

  it("reads a document, and says why when the instance cannot tell it", async () => {
    api.answers.set("GET /api/knowledge/manuals/documents/quotes.md", json({ ...QUOTES, text: "# Quotes\n" }));
    api.sync.open("manuals", "quotes.md");
    await settled();
    assert.deepEqual(api.told, [{ type: "opened", document: { ...QUOTES, text: "# Quotes\n" } }]);
    api.answers.set("GET /api/knowledge/manuals/documents/gone.md", json({ code: "unknown_document", detail: "None." }, 404));
    api.sync.open("manuals", "gone.md");
    await settled();
    assert.deepEqual(api.told.at(-1), { type: "unopened", source: "manuals", name: "gone.md", message: "La source ne contient plus ce document." });
  });

  it("uploads the files chosen, says it is on its way, then the documents as they are now", async () => {
    api.answers.set("POST /api/knowledge/manuals/documents", json({ items: [QUOTES] }, 201));
    api.sync.upload("manuals", [new File(["# Quotes\n"], "quotes.md")]);
    await settled();
    assert.deepEqual(api.told, [
      { type: "sending", source: "manuals" },
      { type: "changed", source: "manuals", items: [QUOTES], uploaded: 1 },
    ]);
  });

  it("refuses at once, without a call, files that break a rule of an upload, each error at its file", async () => {
    const large = new File([new Uint8Array(MAX_DOCUMENT_BYTES + 1)], "large.md");
    api.sync.upload("manuals", [new File(["#"], "quotes.md"), new File(["%PDF"], "quotes.pdf"), large]);
    await settled();
    assert.deepEqual(api.calls, []);
    const [refused] = api.told;
    assert.ok(refused?.type === "refused");
    assert.deepEqual(
      [refused.refusal.code, refused.refusal.text, refused.refusal.names, refused.refusal.errors.map(({ path, rule }) => `${path} ${rule}`)],
      [
        "invalid_documents",
        "Les documents sont refusés, et aucun n’a été gardé : corrigez les fichiers signalés.",
        ["quotes.md", "quotes.pdf", "large.md"],
        ["/documents/1 document-format", "/documents/2 document-size"],
      ],
    );
  });

  it("tells why the instance refused an upload, with the errors it found", async () => {
    const error = { kind: "structure", path: "/documents/0", rule: "document-encoding", message: "Expected a text in UTF-8." };
    api.answers.set("POST /api/knowledge/manuals/documents", json({ code: "invalid_documents", detail: "Refused.", errors: [error] }, 422));
    api.sync.upload("manuals", [new File([new Uint8Array([0xff])], "image.md")]);
    await settled();
    assert.deepEqual(api.told.at(-1), {
      type: "refused",
      source: "manuals",
      refusal: {
        code: "invalid_documents",
        text: "Les documents sont refusés, et aucun n’a été gardé : corrigez les fichiers signalés.",
        errors: [error],
        names: ["image.md"],
      },
    });
  });

  it("maps the knowledge again, a source or every source, and tells what came of it, or why it failed", async () => {
    const outcome = { state: "unknown", source: "nowhere" } as const;
    api.answers.set("POST /api/knowledge/mapping", json(outcome));
    api.sync.remap("nowhere");
    await settled();
    assert.deepEqual(api.told, [
      { type: "remapping", source: "nowhere" },
      { type: "remapped", source: "nowhere", outcome },
    ]);
    api.answers.set("POST /api/knowledge/mapping", json({ code: "unavailable", detail: "Down." }, 503));
    api.sync.remap();
    await settled();
    assert.deepEqual(api.told.slice(-2), [
      { type: "remapping" },
      { type: "remapped", failure: "Aucune source de sessions n’est configurée sur cette instance." },
    ]);
  });

  it("removes a document, then lists those left, or tells why it could not", async () => {
    api.answers.set("DELETE /api/knowledge/manuals/documents/quotes.md", json(undefined, 204));
    api.answers.set("GET /api/knowledge/manuals/documents", json({ items: [] }));
    api.sync.remove("manuals", "quotes.md");
    await settled();
    assert.deepEqual(api.told, [
      { type: "sending", source: "manuals" },
      { type: "changed", source: "manuals", items: [], uploaded: 0 },
    ]);
    api.answers.set("DELETE /api/knowledge/manuals/documents/quotes.md", json({ code: "unknown_document", detail: "None." }, 404));
    api.sync.remove("manuals", "quotes.md");
    await settled();
    assert.deepEqual(api.told.at(-1), {
      type: "refused",
      source: "manuals",
      refusal: { code: "unknown_document", text: "La source ne contient plus ce document.", errors: [], names: [] },
    });
  });
});
