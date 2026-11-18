import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { byCodeUnits } from "../src/index.ts";

describe("the order of texts by their code units", () => {
  it("puts capitals before small letters and is told equal texts, whatever the locale", () => {
    assert.deepEqual(["b", "README.md", "a", "B", "a"].sort(byCodeUnits), ["B", "README.md", "a", "a", "b"]);
    assert.equal(byCodeUnits("x", "x"), 0);
  });
});
