import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { polledAfter } from "../../src/api/polled-state.ts";

describe("what a screen holds of what it asks the instance again and again", () => {
  it("is the latest answer, which stays shown, with why, while the instance does not answer", () => {
    const read = polledAfter<number>({}, { type: "read", value: 1 });
    const unread = polledAfter(read, { type: "unread", message: "Down." });
    assert.deepEqual([read, unread, polledAfter(unread, { type: "read", value: 2 })], [{ value: 1 }, { value: 1, unread: "Down." }, { value: 2 }]);
  });
});
