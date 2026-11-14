import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateConfig, type ResolvedConfig } from "@open-qa-stack/shared";
import { sessionTools } from "../src/designer/session-tools.ts";

const ENV = { SHOP_DB_URL: "postgresql://shop:s3cret-db-pass@127.0.0.1:5999/shop" };

function config(): ResolvedConfig {
  const text = JSON.stringify({
    formatVersion: 1,
    applications: [
      { id: "shop", name: "Shop", type: "web", authentication: { method: "none" }, environments: [{ name: "local", uiUrl: "http://127.0.0.1:1/" }] },
      {
        id: "ledger",
        name: "Ledger",
        type: "api",
        authentication: { method: "none" },
        environments: [{ name: "local", apis: [{ name: "api", baseUrl: "http://127.0.0.1:1" }] }],
      },
    ],
    knowledge: [
      { id: "shop-db", type: "postgresql", connectionStringEnv: "SHOP_DB_URL", attachments: [{ application: "shop" }] },
      { id: "order-specs", type: "document", path: "specs/orders.md", attachments: [{ application: "shop" }] },
    ],
    model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:1/v1", model: "test-model" },
    autonomy: { level: "bounded", task: { maxIterations: 20, maxMinutes: 10, maxActions: 200 } },
  });
  const result = validateConfig(text, ENV);
  assert.ok(result.ok, JSON.stringify(result));
  return result.config;
}

/** The tools of a session on the applications and the sources of the configuration that are named. */
function session(applications: readonly string[], sources: readonly string[]) {
  const resolved = config();
  return sessionTools({
    config: resolved,
    repositoryRoot: "/nowhere",
    env: ENV,
    environment: "local",
    applications: resolved.applications.filter((application) => applications.includes(application.id)),
    sources: resolved.knowledge.filter((source) => sources.includes(source.id)),
    start: new Date("2026-11-13T10:00:00.000Z"),
    browser: undefined,
  });
}

const names = (tools: readonly { name: string }[]) => tools.map((tool) => tool.name);

describe("the tools of a session of a design", () => {
  it("are the browser tools of its applications that have a user interface, watched", async () => {
    const made = session(["shop", "ledger"], []);
    const { screens } = made;
    assert.ok(names(screens.tools()).includes("shop_goto"));
    assert.deepEqual(
      names(screens.tools()).filter((name) => name.startsWith("ledger_")),
      [],
    );
    assert.equal(screens.watches("shop"), true);
    assert.equal(screens.watches("ledger"), false);
    assert.match(screens.tools().find((tool) => tool.name === "shop_goto")!.description, /Returns what the page shows/);
    // No tool was called: no browser started, and there is none to close.
    await made.close();
  });

  it("are the tools of its sources alone, watched, the search of a base saying where the data of a plan come from", async () => {
    const made = session([], ["shop-db", "order-specs"]);
    const { screens, reads } = made;
    assert.deepEqual(screens.tools(), []);
    const tools = reads.tools();
    assert.ok(names(tools).some((name) => name.startsWith("order_specs_")));
    assert.match(tools.find((tool) => tool.name === "shop_db_search")!.description, /A value of the data of a plan comes from a result such as this one\.$/);
    assert.doesNotMatch(tools.find((tool) => tool.name === "shop_db_query")!.description, /data of a plan/);
    assert.equal(reads.firstTool("order-specs")?.startsWith("order_specs_"), true);
    await made.close();

    const one = session([], ["order-specs"]);
    assert.deepEqual(
      names(one.reads.tools()).filter((name) => name.startsWith("shop_db_")),
      [],
    );
  });
});
