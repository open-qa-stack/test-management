import assert from "node:assert/strict";
import type { Model } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import { connectionOf, modelChoices, modelFor, sameReach } from "../../src/configuration/model-connection.ts";

const LOCAL: Model = { mode: "provider-key", provider: "openai", baseUrl: "http://localhost:1234/v1", model: "local", apiKeyEnv: "LOCAL_KEY" };
const OPENAI: Model = { mode: "provider-key", provider: "openai", baseUrl: "https://api.openai.com/v1/", model: "gpt-4.1", apiKeyEnv: "OPENAI_API_KEY" };
const GITHUB: Model = { mode: "github", model: "gpt-5" };

describe("the choice of the connection to the model", () => {
  it("is the GitHub account, the provider the address belongs to, or another server", () => {
    assert.equal(connectionOf(GITHUB), "github");
    assert.equal(connectionOf(OPENAI), "OpenAI");
    assert.equal(connectionOf(LOCAL), "other");
  });

  it("starts the model again from the choice: the account, a provider with its address and variable, another server with the address it had", () => {
    assert.deepEqual(modelFor("github", OPENAI), { mode: "github", model: "" });
    assert.deepEqual(modelFor("Mistral AI", GITHUB), {
      mode: "provider-key",
      provider: "openai",
      baseUrl: "https://api.mistral.ai/v1",
      model: "",
      apiKeyEnv: "MISTRAL_API_KEY",
    });
    assert.deepEqual(modelFor("other", LOCAL), { mode: "provider-key", provider: "openai", baseUrl: "http://localhost:1234/v1", model: "" });
    assert.deepEqual(modelFor("other", OPENAI), { mode: "provider-key", provider: "openai", baseUrl: "", model: "" });
    assert.deepEqual(modelFor("other", GITHUB), { mode: "provider-key", provider: "openai", baseUrl: "", model: "" });
  });

  it("keeps a test while the model is reached the same way, whichever model is chosen", () => {
    assert.ok(sameReach(GITHUB, { mode: "github", model: "" }));
    assert.ok(!sameReach(GITHUB, OPENAI));
    assert.ok(!sameReach(OPENAI, GITHUB));
    assert.ok(sameReach(LOCAL, { ...LOCAL, model: "other" }));
    assert.ok(!sameReach(LOCAL, { ...LOCAL, baseUrl: "http://localhost:4321/v1" }));
    assert.ok(!sameReach(LOCAL, { ...LOCAL, apiKeyEnv: "OTHER" }));
  });

  it("offers the models a test found, with the one chosen when the list lacks it, and none when the connection gives no list", () => {
    const listed = [{ id: "a", name: "A", reasoningEfforts: [] }];
    assert.equal(modelChoices(undefined, ""), undefined);
    assert.equal(modelChoices({ state: "signed-out" }, ""), undefined);
    assert.equal(modelChoices({ state: "connected" }, ""), undefined);
    assert.deepEqual(modelChoices({ state: "connected", models: listed }, ""), listed);
    assert.deepEqual(modelChoices({ state: "connected", models: listed }, "a"), listed);
    assert.deepEqual(modelChoices({ state: "connected", models: listed }, "b"), [{ id: "b", name: "b", reasoningEfforts: [] }, ...listed]);
  });
});
