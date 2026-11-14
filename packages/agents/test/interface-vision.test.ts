import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { validateConfig, type ResolvedConfig } from "@open-qa-stack/shared";
import { testSite } from "@open-qa-stack/testing";
import { imageSecrets } from "../src/common/config-secrets.ts";
import { totalUsage, usageOf } from "../src/common/model-usage.ts";
import { interfaceSubject } from "../src/source-cartographer/card-subject.ts";

const DATABASE = "postgresql://u:dbpw@h/db";
/** The variables the configuration names, set so that it validates; each test gives the tools its own environment. */
const SET = { ADMIN_USER: "root", ADMIN_PASSWORD: "x", AUDIT_USER: "audit", AUDIT_PASSWORD: "x", SHOP_DB_URL: "x" };

function configFor(uiUrl: string, capabilities: readonly string[]): ResolvedConfig {
  const result = validateConfig(
    JSON.stringify({
      formatVersion: 1,
      applications: [
        { id: "shop", name: "Shop", type: "web", authentication: { method: "none" }, environments: [{ name: "local", uiUrl }] },
        {
          id: "admin",
          name: "Admin",
          type: "web",
          authentication: {
            method: "form",
            accounts: [
              { name: "root", usernameEnv: "ADMIN_USER", passwordEnv: "ADMIN_PASSWORD" },
              { name: "audit", usernameEnv: "AUDIT_USER", passwordEnv: "AUDIT_PASSWORD" },
            ],
          },
          environments: [{ name: "staging", uiUrl: "http://127.0.0.1:9" }],
        },
      ],
      knowledge: [{ id: "shop-db", type: "postgresql", connectionStringEnv: "SHOP_DB_URL", attachments: [{ application: "shop" }] }],
      model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:1/v1", model: "m", capabilities },
    }),
    SET,
  );
  assert.ok(result.ok, JSON.stringify(result));
  return result.config;
}

describe("the card of a user interface, with a model that reads images", () => {
  it("gives the agent a screenshot tool that shows the image when the configuration declares it, and the path alone otherwise", async () => {
    const site = await testSite({ "/": "<h1>Shop</h1>" });
    try {
      for (const [capabilities, vision] of [
        [["vision"], true],
        [[], false],
      ] as const) {
        const subject = await interfaceSubject(
          configFor(site.origin, capabilities),
          { id: "shop", type: "web", environment: "local" },
          {
            env: {},
            screenshotsDir: "screenshots",
          },
        );
        const screenshot = subject.tools.find((tool) => tool.name === "shop_screenshot")!;
        assert.equal("within" in (screenshot.parameters["properties"] as object), vision);
        await subject.close();
      }
    } finally {
      await site.close();
    }
  });

  it("shows no image of a page that shows a secret of the configuration", async () => {
    const site = await testSite({ "/": `<p>Connected to ${DATABASE}</p>` });
    const folder = mkdtempSync(join(tmpdir(), "oqas-shots-"));
    try {
      const subject = await interfaceSubject(
        configFor(site.origin, ["vision"]),
        { id: "shop", type: "web", environment: "local" },
        {
          env: { SHOP_DB_URL: DATABASE },
          screenshotsDir: folder,
        },
      );
      try {
        const result = await subject.tools.find((tool) => tool.name === "shop_screenshot")!.execute({});
        assert.equal((result as { imageNotShown?: string }).imageNotShown, "The page shows a secret of the configuration: its image is not shown.");
      } finally {
        await subject.close();
      }
    } finally {
      await site.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe("the secrets no screenshot shown to a model may show", () => {
  it("are those of the configuration and the passwords of the test accounts set, each once", () => {
    const env = { SHOP_DB_URL: DATABASE, ADMIN_USER: "root", ADMIN_PASSWORD: DATABASE, AUDIT_PASSWORD: "" };
    assert.deepEqual(imageSecrets(configFor("http://127.0.0.1:9", []), env), [DATABASE]);
    assert.deepEqual(imageSecrets(configFor("http://127.0.0.1:9", []), { ADMIN_PASSWORD: "admin-pw" }), ["admin-pw"]);
  });
});

describe("the usage of tasks", () => {
  it("keeps the tokens of the images the harness counted, and adds them up", () => {
    const shown = usageOf({ iterations: 2, actions: 0, elapsedMs: 0, inputTokens: 30, outputTokens: 5, imageTokens: 2000 });
    const unseen = usageOf({ iterations: 1, actions: 0, elapsedMs: 0 });
    assert.deepEqual(shown, { requests: 2, inputTokens: 30, outputTokens: 5, imageTokens: 2000 });
    assert.deepEqual(unseen, { requests: 1 });
    assert.deepEqual(totalUsage([shown, unseen, shown]), { requests: 5, inputTokens: 60, outputTokens: 10, imageTokens: 4000 });
    assert.deepEqual(totalUsage([unseen]), { requests: 1 });
  });

  it("keeps the tokens the server of the model read from its cache, and adds them up", () => {
    const cached = usageOf({ iterations: 2, actions: 0, elapsedMs: 0, inputTokens: 30, outputTokens: 5, cachedTokens: 20 });
    const plain = usageOf({ iterations: 1, actions: 0, elapsedMs: 0, inputTokens: 10, outputTokens: 1 });
    assert.deepEqual(cached, { requests: 2, inputTokens: 30, outputTokens: 5, cachedTokens: 20 });
    assert.deepEqual(totalUsage([cached, plain, cached]), { requests: 5, inputTokens: 70, outputTokens: 11, cachedTokens: 40 });
    assert.deepEqual(totalUsage([plain]), { requests: 1, inputTokens: 10, outputTokens: 1 });
  });
});
