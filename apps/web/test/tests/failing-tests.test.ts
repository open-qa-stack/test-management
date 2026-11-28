import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { failingTests } from "../../src/tests/failing-tests.ts";

describe("the tests that failed last", () => {
  it("are counted once each, by their file and their title, those that passed or were flaky left out", () => {
    assert.equal(
      failingTests([
        { path: "a.spec.ts", title: "A", verdict: "failed" },
        { path: "a.spec.ts", title: "A", verdict: "failed" },
        { path: "a.spec.ts", title: "B", verdict: "failed" },
        { path: "b.spec.ts", title: "A", verdict: "failed" },
        { path: "c.spec.ts", title: "C", verdict: "passed" },
        { path: "d.spec.ts", title: "D", verdict: "flaky" },
      ]),
      3,
    );
    assert.equal(failingTests([]), 0);
  });
});
