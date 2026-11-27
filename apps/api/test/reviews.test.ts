import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ReviewRefusedError } from "@open-qa-stack/domain";
import { expectedProblem } from "../src/problems/expected-problem.ts";
import { problemOf } from "../src/problems/problem-kinds.ts";

describe("a decision of the review the repository cannot take now", () => {
  it("is told review_refused, with what to do", () => {
    const why = "A session runs or waits in the test repository: validate the test once it ended.";
    assert.deepEqual(expectedProblem(new ReviewRefusedError(why)), { ...problemOf("review_refused", why), status: 409 });
  });
});
