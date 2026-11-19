import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { INITIAL_TEST, testAfter } from "../../src/tests/test-state.ts";
import { READING } from "./tests-fixture.ts";

describe("the state of the screen of a test", () => {
  it("holds the test the instance read, and keeps it shown while it does not answer", () => {
    const read = testAfter(INITIAL_TEST, { type: "read", reading: READING });
    assert.deepEqual(read, { reading: READING });
    assert.deepEqual(testAfter(read, { type: "unread", message: "Down." }), { reading: READING, unread: "Down." });
  });
});
