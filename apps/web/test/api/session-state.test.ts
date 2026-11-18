import assert from "node:assert/strict";
import type { SessionState } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import { hasEnded } from "../../src/api/session-state.ts";

describe("whether a session ended", () => {
  it("has not while it waits its turn, nor while its agents work", () => {
    assert.deepEqual((["queued", "running"] as const).map(hasEnded), [false, false]);
  });

  it("has once it completed or was interrupted, and in a state this console does not know", () => {
    assert.deepEqual(
      ["completed", "interrupted", "archived"].map((state) => hasEnded(state as SessionState)),
      [true, true, true],
    );
  });
});
