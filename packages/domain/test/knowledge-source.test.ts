import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { isKnowledgeSource } from "../src/index.ts";

describe("a knowledge source as the person drafts it", () => {
  it("is one the configuration would accept once named and attached", () => {
    assert.equal(isKnowledgeSource({ id: "", type: "document", path: "docs", attachments: [] }), true);
    assert.equal(isKnowledgeSource({ type: "postgresql", connectionStringEnv: "SHOP_DB_URL" }), true);
    assert.equal(isKnowledgeSource({ id: "manuals", type: "document", stored: true, attachments: [{ application: "shop" }] }), true);
  });

  it("is none that lacks what reaches it, names a kind the configuration does not know, or is no object", () => {
    assert.equal(isKnowledgeSource({ type: "postgresql" }), false);
    assert.equal(isKnowledgeSource({ type: "tickets", path: "x" }), false);
    assert.equal(isKnowledgeSource("docs"), false);
  });
});
