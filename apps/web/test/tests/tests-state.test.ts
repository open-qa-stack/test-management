import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { INITIAL_TESTS, testsAfter } from "../../src/tests/tests-state.ts";
import { TESTS } from "./tests-fixture.ts";

describe("the state of the screen of the tests", () => {
  it("holds the tests the instance listed, and keeps them shown while it does not answer", () => {
    const listed = testsAfter(INITIAL_TESTS, { type: "listed", tests: TESTS });
    assert.deepEqual(listed, { tests: TESTS });
    const unread = testsAfter(listed, { type: "unread", message: "L’instance ne répond pas." });
    assert.deepEqual(unread, { tests: TESTS, unread: "L’instance ne répond pas." });
    assert.deepEqual(testsAfter(unread, { type: "listed", tests: [] }), { tests: [] });
  });
});
