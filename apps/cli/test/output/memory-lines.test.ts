import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { memoryLine } from "../../src/output/memory-lines.ts";

describe("a line of the memory, as oqas memory tells it", () => {
  it("names a correction by its application, and what an agent noted by its domain, its kind and its role", () => {
    assert.equal(
      memoryLine({ id: "l2", type: "correction", text: "Use Max.", application: "policy", target: "design", active: false, at: "2026-11-27T10:00:00.000Z" }),
      "l2  set aside  correction  (policy; design)  Use Max.",
    );
    assert.equal(
      memoryLine({
        id: "m1",
        type: "inferred",
        text: "Quote screens bear data-testid.",
        target: "all",
        active: true,
        at: "2026-11-27T10:00:00.000Z",
        filed: { domain: "quotes", kind: "locator", role: "cartographer" },
      }),
      "m1  active  noted by an agent  (quotes, locator, by the cartographer; all)  Quote screens bear data-testid.",
    );
  });
});
