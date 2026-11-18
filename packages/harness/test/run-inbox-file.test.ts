import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { runInboxFile } from "../src/index.ts";

describe("the inbox of a run", () => {
  it("is named after the run, beside its journal", () => {
    assert.equal(runInboxFile("oqas-2026-11-13T12-00-00-000Z"), "oqas-2026-11-13T12-00-00-000Z.inbox.jsonl");
  });
});
