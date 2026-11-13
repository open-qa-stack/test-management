import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateConfig } from "@open-qa-stack/shared";
import { runSources } from "../src/cartographer/run-sources.ts";

describe("the sources of a cartography", () => {
  it("leave the logs out, since they tell what a service did and not what an application holds", () => {
    const result = validateConfig(
      JSON.stringify({
        formatVersion: 1,
        applications: [{ id: "shop", name: "Shop", type: "web", authentication: { method: "none" }, environments: [{ name: "local", uiUrl: "http://127.0.0.1:1" }] }],
        knowledge: [
          { id: "shop-logs", type: "logs", container: "shop", engine: "podman", attachments: [{ application: "shop" }] },
          { id: "specs", type: "document", path: "specs.md", attachments: [{ application: "shop" }] },
        ],
        model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:1/v1", model: "m" },
        autonomy: { level: "supervised" },
      }),
      {},
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(runSources(result.config, "local").map((source) => source.id), ["specs", "shop"]);
  });
});
