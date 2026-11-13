import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spanWholeSource } from "./source-map-span.ts";

describe("source map span", () => {
  it("maps the first generated line to the first source line, and the closing line to the last one", () => {
    // The segments reach line 3, column 4 of the source; the closing one moves 2 lines down and 4 columns back.
    assert.equal(spanWholeSource(";AACE;AAEE", 3, 5), "AAAA;AACE;AAEE;AAEJ");
  });

  it("keeps the segments the first generated line already has", () => {
    assert.equal(spanWholeSource("EAAA", 1, 0), "AAAA,EAAA;AAAA");
  });

  it("encodes deltas of more than one digit", () => {
    // Source line 16, then 24 lines down to line 40.
    assert.equal(spanWholeSource(";AAgBA", 2, 40), "AAAA;AAgBA;AAwBA");
  });
});
