import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { hasEnded, type SessionState } from "../src/sessions/index.ts";

describe("whether a session ended", () => {
  it("has not while it waits its turn, nor while its agents work", () => {
    assert.deepEqual((["queued", "running"] as const).map(hasEnded), [false, false]);
  });

  it("has once it completed or was interrupted, and in a state this version does not know", () => {
    assert.deepEqual(
      ["completed", "interrupted", "archived"].map((state) => hasEnded(state as SessionState)),
      [true, true, true],
    );
  });
});
