import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { declaredVariables, GITHUB_COPILOT_URL, isModel, MODEL_PROVIDERS, modelOrigin, providerOf } from "../src/index.ts";
import { errorsOf, validateVariant } from "./helpers.ts";

describe("a model of GitHub Copilot", () => {
  it("is named alone: the GitHub account of the machine reaches it, with no address and no key", () => {
    const result = validateVariant((c) => (c["model"] = { mode: "github", model: "gpt-5", reasoningEffort: "high", capabilities: ["vision"] }));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(result.ok);
    assert.deepEqual(result.config.model, { mode: "github", model: "gpt-5", reasoningEffort: "high", capabilities: ["vision"] });
    assert.deepEqual(
      declaredVariables(result.config).filter(({ path }) => path.startsWith("/model")),
      [],
    );
  });

  it("refuses what only a server has: an address, a key, a wait", () => {
    for (const key of ["baseUrl", "apiKeyEnv", "requestTimeoutSeconds", "provider"]) {
      const errors = errorsOf(validateVariant((c) => (c["model"] = { mode: "github", model: "gpt-5", [key]: "x" })));
      assert.ok(errors.length > 0, key);
    }
  });

  it("is told, in what a run keeps, as served by github at the address of Copilot", () => {
    assert.deepEqual(modelOrigin({ mode: "github", model: "gpt-5" }), { provider: "github", baseUrl: GITHUB_COPILOT_URL, model: "gpt-5" });
    assert.deepEqual(modelOrigin({ mode: "provider-key", provider: "openai", baseUrl: "http://x/v1", model: "m" }), {
      provider: "openai",
      baseUrl: "http://x/v1",
      model: "m",
    });
  });
});

describe("the providers the console offers by name", () => {
  it("are known by their address, with or without its last slash, and no other server is", () => {
    assert.equal(MODEL_PROVIDERS.length, 5);
    assert.equal(MODEL_PROVIDERS[0]!.name, "OpenAI");
    for (const provider of MODEL_PROVIDERS) assert.equal(providerOf(`${provider.baseUrl}/`), provider);
    assert.equal(providerOf("https://api.mistral.ai/v1")?.apiKeyEnv, "MISTRAL_API_KEY");
    assert.equal(providerOf("http://localhost:1234/v1"), undefined);
  });
});

describe("a connection to the model sent alone", () => {
  it("is one the section model of a configuration accepts", () => {
    assert.ok(isModel({ mode: "github", model: "gpt-5" }));
    assert.ok(isModel({ mode: "github", model: "" }));
    assert.ok(isModel({ mode: "provider-key", provider: "openai", baseUrl: "http://localhost:1234/v1", model: "m" }));
    assert.ok(!isModel({ mode: "provider-key", provider: "openai", baseUrl: "not a url", model: "m" }));
    assert.ok(!isModel({ mode: "github" }));
    assert.ok(!isModel("github"));
  });
});
