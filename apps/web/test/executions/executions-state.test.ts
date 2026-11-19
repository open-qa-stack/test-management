import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { executionsAfter, INITIAL_EXECUTIONS } from "../../src/executions/executions-state.ts";
import { EXECUTIONS } from "./executions-fixture.ts";

describe("the state of the screen of the executions", () => {
  it("holds the executions the instance listed, and keeps them shown while it does not answer", () => {
    const listed = executionsAfter(INITIAL_EXECUTIONS, { type: "listed", executions: EXECUTIONS });
    assert.deepEqual(listed, { executions: EXECUTIONS });
    const unread = executionsAfter(listed, { type: "unread", message: "L’instance ne répond pas." });
    assert.deepEqual(unread, { executions: EXECUTIONS, unread: "L’instance ne répond pas." });
    assert.deepEqual(executionsAfter(unread, { type: "listed", executions: [] }), { executions: [] });
  });
});
