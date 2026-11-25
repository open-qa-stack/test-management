import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { roleConfig, roleModel, type Model } from "../src/index.ts";
import { at, errorsOf, validateVariant } from "./helpers.ts";

const SHARED: Model = { mode: "github", model: "gpt-5", reasoningEffort: "high", capabilities: ["vision"] };

describe("the model of a role", () => {
  it("is that of every one, without the models of the roles, for a role that has none", () => {
    assert.deepEqual(roleModel(SHARED, "designer"), SHARED);
    assert.deepEqual(roleModel({ ...SHARED, roles: { reviewer: { model: "big" } } }, "designer"), SHARED);
  });

  it("is its own, through the same connection, and takes over nothing tuned on the other", () => {
    const local: Model = {
      mode: "provider-key",
      provider: "openai",
      baseUrl: "http://x/v1",
      model: "m",
      apiKeyEnv: "KEY",
      requestTimeoutSeconds: 30,
      reasoningEffort: "high",
    };
    assert.deepEqual(roleModel({ ...local, roles: { cartographer: { model: "small", capabilities: ["vision"] } } }, "cartographer"), {
      mode: "provider-key",
      provider: "openai",
      baseUrl: "http://x/v1",
      model: "small",
      apiKeyEnv: "KEY",
      requestTimeoutSeconds: 30,
      capabilities: ["vision"],
    });
  });

  it("is in the configuration, and in that its role reads", () => {
    const result = validateVariant((c) => (at(c, "model")["roles"] = { reviewer: { model: "big", reasoningEffort: "low" } }));
    assert.ok(result.ok);
    assert.equal(roleConfig(result.config, "reviewer").model.model, "big");
    assert.notEqual(roleConfig(result.config, "designer").model.model, "big");
  });

  it("is refused for a role there is not, or without its name", () => {
    const paths = (roles: object) => errorsOf(validateVariant((c) => (at(c, "model")["roles"] = roles))).map(({ path }) => path);
    assert.equal(paths({ analyst: { model: "m" } }).length, 1);
    assert.equal(paths({ reviewer: {} }).length, 1);
  });
});
