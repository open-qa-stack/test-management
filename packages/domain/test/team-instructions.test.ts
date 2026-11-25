import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { MAX_TEAM_INSTRUCTIONS, teamInstructions } from "../src/index.ts";
import { errorsOf, validateVariant } from "./helpers.ts";

describe("what the team asks of an agent", () => {
  it("is its text without the spaces around it, and nothing for an agent it asks nothing of", () => {
    assert.equal(teamInstructions({ writer: { instructions: " Say policy. " } }, "writer"), "Say policy.");
    for (const agents of [undefined, {}, { writer: {} }, { writer: { instructions: " " } }]) assert.equal(teamInstructions(agents, "writer"), undefined);
  });

  it("is in the configuration, within a length, for an agent there is", () => {
    const told = (agents: object) => validateVariant((c) => (c["agents"] = agents));
    const result = told({ planner: { instructions: "x".repeat(MAX_TEAM_INSTRUCTIONS) } });
    assert.ok(result.ok && result.config.agents.planner !== undefined);
    assert.deepEqual(validateVariant(() => undefined).ok && {}, {});
    assert.deepEqual(
      errorsOf(told({ planner: { instructions: "x".repeat(MAX_TEAM_INSTRUCTIONS + 1) } })).map(({ path }) => path),
      ["/agents/planner/instructions"],
    );
    assert.equal(errorsOf(told({ robot: {} })).length, 1);
  });
});
