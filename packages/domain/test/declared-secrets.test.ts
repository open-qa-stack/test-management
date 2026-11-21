import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { declaredSecrets, type OqasConfig } from "../src/index.ts";

/** A configuration that names the same variable twice, beside the others. */
const CONFIG = {
  applications: [
    {
      authentication: { method: "form", accounts: [{ name: "clerk", usernameEnv: "SHOP_USER", passwordEnv: "SHOP_PASSWORD" }] },
    },
    { authentication: { method: "none" } },
  ],
  knowledge: [
    { id: "orders", type: "postgresql", connectionStringEnv: "SHOP_DB_URL" },
    { id: "spec", type: "openapi", path: "openapi.json" },
    { id: "stock", type: "postgresql", connectionStringEnv: "SHOP_DB_URL" },
  ],
  model: { mode: "provider-key", provider: "openai", baseUrl: "https://api.openai.com/v1", model: "m", apiKeyEnv: "OPENAI_API_KEY" },
} as unknown as OqasConfig;

describe("the variables a configuration names, whose values a person gives", () => {
  it("are each listed once, with every key that names them and what they hold, in the order of the file", () => {
    assert.deepEqual(declaredSecrets(CONFIG), [
      { name: "SHOP_USER", kind: "account_username", paths: ["/applications/0/authentication/accounts/0/usernameEnv"] },
      { name: "SHOP_PASSWORD", kind: "account_password", paths: ["/applications/0/authentication/accounts/0/passwordEnv"] },
      { name: "SHOP_DB_URL", kind: "connection_string", paths: ["/knowledge/0/connectionStringEnv", "/knowledge/2/connectionStringEnv"] },
      { name: "OPENAI_API_KEY", kind: "model_key", paths: ["/model/apiKeyEnv"] },
    ]);
  });

  it("are none for a configuration that names none", () => {
    assert.deepEqual(declaredSecrets({ applications: [], knowledge: [], model: { mode: "github", model: "m" } } as unknown as OqasConfig), []);
  });
});
