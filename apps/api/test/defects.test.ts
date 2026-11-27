import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DefectRefusedError } from "@open-qa-stack/domain";
import { expectedProblem } from "../src/problems/expected-problem.ts";
import { problemOf } from "../src/problems/problem-kinds.ts";

describe("a move of a defect its life does not allow", () => {
  it("is told defect_refused, with where the defect can go", () => {
    const why = "The defect D-1 is closed: from there it can be open.";
    assert.deepEqual(expectedProblem(new DefectRefusedError(why)), { ...problemOf("defect_refused", why), status: 409 });
  });
});
