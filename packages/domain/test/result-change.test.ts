import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { resultChange } from "../src/index.ts";

describe("what an execution changed for a test since the last one that ran it", () => {
  it("is a new failure when it did not fail before, and a failure still when it did", () => {
    assert.equal(resultChange({ verdict: "failed", previous: "passed" }), "new_failure");
    assert.equal(resultChange({ verdict: "failed", previous: "flaky" }), "new_failure");
    assert.equal(resultChange({ verdict: "failed", previous: "failed" }), "still_failing");
  });

  it("is a fix when it passed, at once or on a retry, and failed before", () => {
    assert.equal(resultChange({ verdict: "passed", previous: "failed" }), "fixed");
    assert.equal(resultChange({ verdict: "flaky", previous: "failed" }), "fixed");
  });

  it("is nothing when it passed before too, did not run, or never ran before", () => {
    assert.equal(resultChange({ verdict: "passed", previous: "passed" }), undefined);
    assert.equal(resultChange({ verdict: "skipped", previous: "failed" }), undefined);
    assert.equal(resultChange({ verdict: "failed" }), undefined);
  });
});
