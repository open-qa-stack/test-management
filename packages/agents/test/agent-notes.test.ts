import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { validateConfig } from "@open-qa-stack/domain";
import { agentNotes, agentRecall, NOTES_FILE } from "../src/common/agent-notes.ts";
import { configSecrets } from "../src/common/config-secrets.ts";

describe("the notes of the agents", () => {
  it("refuse the connection strings and the key of the model, keep a password, and live in the state folder", async () => {
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
    const root = mkdtempSync(join(tmpdir(), "oqas-agent-notes-"));
    try {
      const [remember] = agentNotes(result.config, root, env, { role: "cartographer", task: "t" });
      for (const secret of [env.SHOP_DB_URL, env.MODEL_KEY])
        assert.ok("error" in ((await remember!.execute({ text: `It is ${secret}.`, tags: ["x"] })) as object), secret);
      assert.equal(await remember!.execute({ text: "A plain fact.", tags: ["x"] }), "Kept.");
      assert.equal(await remember!.execute({ text: "The doc gives pw-123456 and dbpw.", tags: ["x"] }), "Kept.");
      assert.match(readFileSync(join(root, ".oqas", NOTES_FILE), "utf8"), /A plain fact\./);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("have no key of the model to refuse when the model needs none", () => {
    const text = JSON.stringify({
      formatVersion: 1,
      applications: [{ id: "shop", name: "Shop", type: "api", authentication: { method: "none" }, environments: [{ name: "local" }] }],
      knowledge: [],
      model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:2/v1", model: "m" },
      autonomy: { level: "autonomous" },
    });
    const result = validateConfig(text, {});
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(agentNotes(result.config, "/tmp", {}, { role: "r", task: "t" }).length, 2);
    // A task that takes no note is given the tool that reads them alone.
    assert.deepEqual(
      agentRecall(result.config, "/tmp", {}, { role: "r", task: "t" }).map((tool) => tool.name),
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
