import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { INITIAL_KNOWLEDGE, knowledgeAfter, type KnowledgeAction, type KnowledgeState } from "../../src/knowledge/knowledge-state.ts";
import { DOCUMENT, VIEW } from "../configuration/configuration-fixture.ts";

const QUOTES = { name: "quotes.md", bytes: 9, uploadedAt: "2026-11-18T09:00:00.000Z" };

/** The state after the actions, from the state before the instance told anything. */
const after = (actions: readonly KnowledgeAction[], from: KnowledgeState = INITIAL_KNOWLEDGE): KnowledgeState => actions.reduce(knowledgeAfter, from);

describe("the state of the screens of the knowledge", () => {
  it("holds the configuration in force once the instance told it, none when it has none, and why it could not", () => {
    const unread = after([{ type: "unread", message: "Down." }]);
    assert.deepEqual(unread, { read: false, documents: {}, unread: "Down." });
    const read = after([{ type: "read", view: VIEW }], unread);
    assert.deepEqual(read, { read: true, documents: {}, configuration: DOCUMENT });
    assert.deepEqual(after([{ type: "read", view: { file: "missing" } }], read), { read: true, documents: {} });
  });

  it("holds the documents of each source, and the document read, or why it could not be", () => {
    const listed = after([
      { type: "listed", source: "manuals", items: [QUOTES] },
      { type: "listed", source: "guides", items: [] },
    ]);
    assert.deepEqual(listed.documents, { manuals: [QUOTES], guides: [] });
    const opened = after([{ type: "opened", document: { ...QUOTES, text: "#" } }], listed);
    assert.deepEqual(opened.opened, { ...QUOTES, text: "#" });
    assert.deepEqual(after([{ type: "unopened", source: "manuals", name: "gone.md", message: "None." }], opened).opened, {
      source: "manuals",
      name: "gone.md",
      unread: "None.",
    });
  });

  it("holds where the last change is: on its way, taken with the documents as they are now, or refused", () => {
    const sending = after([{ type: "sending", source: "manuals" }]);
    assert.deepEqual(sending.change, { source: "manuals", state: "sending" });
    const done = after([{ type: "changed", source: "manuals", items: [QUOTES], uploaded: 1 }], sending);
    assert.deepEqual([done.change, done.documents], [{ source: "manuals", state: "done", uploaded: 1 }, { manuals: [QUOTES] }]);
    const refusal = { code: "unknown_document", text: "None.", errors: [], names: [] } as const;
    assert.deepEqual(after([{ type: "refused", source: "manuals", refusal }], done).change, { source: "manuals", state: "refused", refusal });
  });
});
