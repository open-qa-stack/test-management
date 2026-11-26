import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { OPERATIONS, operationIds } from "../src/index.ts";

describe("the operations of the engine", () => {
  it("are named Class.method, each once, in the order of the list", () => {
    const ids = operationIds();
    assert.equal(ids.length, Object.values(OPERATIONS).flat().length);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(ids.slice(0, 2), ["Sessions.project", "Sessions.sessions"]);
    assert.equal(ids.at(-1), "AgentPrompts.list");
  });
});
