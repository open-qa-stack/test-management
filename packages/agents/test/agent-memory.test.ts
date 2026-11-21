import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { validateConfig } from "@open-qa-stack/domain";
import { KeptMemories } from "@open-qa-stack/testing";
import { agentMemory, agentRecall } from "../src/common/agent-memory.ts";
import { configSecrets } from "../src/common/config-secrets.ts";

describe("the memory of the agents", () => {
  it("refuses the connection strings and the key of the model, keeps a password, and is kept where the run keeps it", async () => {
    const env = { SHOP_PASSWORD: "pw-123456", SHOP_DB_URL: "postgresql://u:dbpw@h/db", MODEL_KEY: "key-abcdef" };
    const text = JSON.stringify({
      formatVersion: 1,
      applications: [
        {
          id: "shop",
          name: "Shop",
          type: "web",
          authentication: { method: "form", accounts: [{ name: "demo", usernameEnv: "SHOP_USER", passwordEnv: "SHOP_PASSWORD" }] },
          environments: [{ name: "local", uiUrl: "http://127.0.0.1:1" }],
        },
      ],
      knowledge: [
        { id: "shop-db", type: "postgresql", connectionStringEnv: "SHOP_DB_URL", attachments: [{ application: "shop" }] },
        { id: "other-db", type: "postgresql", connectionStringEnv: "OTHER_DB_URL", attachments: [{ application: "shop" }] },
      ],
      model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:2/v1", model: "m", apiKeyEnv: "MODEL_KEY" },
      autonomy: { level: "autonomous" },
    });
    const result = validateConfig(text, { ...env, SHOP_USER: "max", OTHER_DB_URL: "x" });
    assert.ok(result.ok);
    const memory = new KeptMemories();
    const [remember] = agentMemory(result.config, memory, env, { role: "cartographer", task: "t" });
    const fact = (text: string) => ({ domain: "general", kind: "pitfall", text, distinct: true });
    for (const secret of [env.SHOP_DB_URL, env.MODEL_KEY]) assert.ok("error" in ((await remember!.execute(fact(`It is ${secret}.`))) as object), secret);
    assert.match(String(await remember!.execute(fact("A plain fact."))), /^Kept as /);
    assert.match(String(await remember!.execute(fact("The doc gives pw-123456 and dbpw."))), /^Kept as /);
    assert.deepEqual(
      (await memory.list({})).map(({ text, written }) => [text, written.role]),
      [
        ["A plain fact.", "cartographer"],
        ["The doc gives pw-123456 and dbpw.", "cartographer"],
      ],
    );
  });

  it("has no key of the model to refuse when the model needs none", () => {
    const text = JSON.stringify({
      formatVersion: 1,
      applications: [{ id: "shop", name: "Shop", type: "api", authentication: { method: "none" }, environments: [{ name: "local" }] }],
      knowledge: [],
      model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:2/v1", model: "m" },
      autonomy: { level: "autonomous" },
    });
    const result = validateConfig(text, {});
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(agentMemory(result.config, new KeptMemories(), {}, { role: "r", task: "t" }).length, 2);
    // A task that takes no note is given the tool that reads them alone.
    assert.deepEqual(
      agentRecall(result.config, new KeptMemories(), {}, { role: "r", task: "t" }).map((tool) => tool.name),
      ["recall"],
    );
  });
});

describe("the secrets of a configuration", () => {
  it("are its connection strings and the key of the model, never the passwords alone", () => {
    const text = JSON.stringify({
      formatVersion: 1,
      applications: [
        {
          id: "shop",
          name: "Shop",
          type: "web",
          authentication: { method: "form", accounts: [{ name: "demo", usernameEnv: "SHOP_USER", passwordEnv: "SHOP_PASSWORD" }] },
          environments: [{ name: "local", uiUrl: "http://127.0.0.1:1" }],
        },
      ],
      knowledge: [{ id: "shop-db", type: "postgresql", connectionStringEnv: "DB", attachments: [{ application: "shop" }] }],
      model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:2/v1", model: "m", apiKeyEnv: "MODEL_KEY" },
      autonomy: { level: "autonomous" },
    });
    const env = { SHOP_USER: "max", SHOP_PASSWORD: "shop2024", DB: "postgresql://u:shop@h/db", MODEL_KEY: "key-abcdef" };
    const result = validateConfig(text, env);
    assert.ok(result.ok);
    assert.deepEqual(configSecrets(result.config, env), ["postgresql://u:shop@h/db", "key-abcdef"]);
  });
});
