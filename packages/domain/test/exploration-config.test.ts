import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { errorsOf, validateVariant } from "./helpers.ts";

type Environments = { environments: Record<string, unknown>[] }[];

describe("what the agent that explores a user interface may do is read from the environment", () => {
  it("is left out when absent, and as given otherwise", () => {
    const absent = validateVariant(() => undefined);
    assert.ok(absent.ok);
    assert.equal(absent.config.applications[0]!.environments[0]!.exploration, undefined);
    const given = validateVariant((config) => ((config["applications"] as Environments)[0]!.environments[0]!["exploration"] = "read-write"));
    assert.ok(given.ok);
    assert.equal(given.config.applications[0]!.environments[0]!.exploration, "read-write");
  });

  it("refuses another word, with its JSON path", () => {
    const errors = errorsOf(validateVariant((config) => ((config["applications"] as Environments)[0]!.environments[0]!["exploration"] = "write")));
    assert.ok(errors.some((error) => error.path === "/applications/0/environments/0/exploration"));
  });
});
