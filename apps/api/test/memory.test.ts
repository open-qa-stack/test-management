import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { MemoryRefusedError, UnknownMemoryError } from "@open-qa-stack/domain";
import { expectedProblem } from "../src/problems/expected-problem.ts";
import { problemOf } from "../src/problems/problem-kinds.ts";

describe("a change of the memory the engine refuses", () => {
  it("is told memory_refused with why, and unknown_memory with where to list them", () => {
    const why = "What an agent noted is for every work and every application: only what it says and whether it applies change.";
    assert.deepEqual(expectedProblem(new MemoryRefusedError(why)), { ...problemOf("memory_refused", why), status: 409 });
    assert.deepEqual(expectedProblem(new UnknownMemoryError("m1")), {
      ...problemOf("unknown_memory", "The instance keeps no lesson nor memory m1. List them with GET /memory."),
      status: 404,
    });
  });
});
