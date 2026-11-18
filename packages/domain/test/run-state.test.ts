import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { isRunState } from "../src/index.ts";

const RUN = "oqas-2026-11-13T12-00-00-000Z";
const STATE = { formatVersion: 1, runId: RUN, environment: "local" };

describe("the state of a run, as a run that resumes it reads it", () => {
  it("is one of that run, in the version of the format, that names its environment", () => {
    assert.equal(isRunState(STATE, RUN), true);
    for (const value of [
      undefined,
      null,
      "state",
      [],
      [STATE],
      { ...STATE, formatVersion: 2 },
      { ...STATE, runId: "oqas-2026-11-13T13-00-00-000Z" },
      { ...STATE, environment: undefined },
      { ...STATE, environment: 3 },
    ]) {
      assert.equal(isRunState(value, RUN), false, JSON.stringify(value));
    }
  });

  it("holds its brief, its branch and its design state as texts, or not at all", () => {
    assert.equal(isRunState({ ...STATE, brief: "cover the profile", branch: "oqas/design", designState: ".oqas/designs/design.json" }, RUN), true);
    for (const key of ["brief", "branch", "designState"]) assert.equal(isRunState({ ...STATE, [key]: 3 }, RUN), false, key);
  });

  it("names the step a limit stopped with that limit, and its index when the step is the design", () => {
    assert.equal(isRunState({ ...STATE, stoppedBy: { step: "cartography", limit: "iterations" } }, RUN), true);
    assert.equal(isRunState({ ...STATE, index: "oqas/index.json", stoppedBy: { step: "design", limit: "wall-clock" } }, RUN), true);
    for (const stoppedBy of [
      "design",
      null,
      ["cartography", "iterations"],
      { step: "cartography" },
      { step: "cartography", limit: 3 },
      { step: "design", limit: "iterations" },
      { step: "execution", limit: "iterations" },
    ]) {
      assert.equal(isRunState({ ...STATE, stoppedBy }, RUN), false, JSON.stringify(stoppedBy));
    }
  });
});
