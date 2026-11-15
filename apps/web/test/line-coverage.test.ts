import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { lineCoverage, type ScriptCoverage } from "./line-coverage.ts";

// Line 0 maps `a();` to line 1 of source 0, then a position to no source; line 1 maps `if` to line 2 of
// source 0, `x` to line 2 of source 1, and `b()`, inside a block that never ran, to line 3 of source 0.
const MAP = { sources: ["a.ts", "b.ts"], mappings: "AAAA,I;AACA,ECAA,GDCA" };
const SCRIPT: ScriptCoverage = {
  source: "a();\nif(x){b()}",
  functions: [
    {
      ranges: [
        { startOffset: 0, endOffset: 15, count: 1 },
        { startOffset: 9, endOffset: 15, count: 0 },
      ],
    },
  ],
};

describe("line coverage", () => {
  it("gives each mapped line of a source the count of the narrowest range around it", () => {
    assert.deepEqual(lineCoverage(SCRIPT, MAP, 0), { lines: [1, 2, 3], uncovered: [3] });
  });

  it("keeps only the positions of the source asked for", () => {
    assert.deepEqual(lineCoverage(SCRIPT, MAP, 1), { lines: [2], uncovered: [] });
  });

  it("counts a position outside every range as not run", () => {
    assert.deepEqual(lineCoverage({ functions: [] }, MAP, 1), { lines: [2], uncovered: [2] });
  });
});
