import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { answer, scriptedServer, testSite, toolCalls } from "@open-qa-stack/testing";
import { browserTools } from "@open-qa-stack/tools";
import { exchange, MODEL, withRuntime } from "./support.ts";

describe("browser actions count against the task's action limit, snapshots do not", () => {
  it("stops a task at its second click under a limit of one action, whatever the snapshots", async () => {
    const site = await testSite({ "/": "<button>Dismiss</button><button>Sign in</button>" });
    const server = await scriptedServer([
      { body: toolCalls(MODEL, [{ id: "c1", name: "shop_click", arguments: { target: { role: "button", name: "Dismiss" } } }]) },
      {
        body: toolCalls(MODEL, [
          { id: "s1", name: "shop_snapshot", arguments: {} },
          { id: "s2", name: "shop_snapshot", arguments: {} },
        ]),
      },
      { body: toolCalls(MODEL, [{ id: "c2", name: "shop_click", arguments: { target: { role: "button", name: "Sign in" } } }]) },
      { body: answer(MODEL, "Done.") },
    ]);
    const screenshots = mkdtempSync(join(tmpdir(), "oqas-shots-"));
    const toolset = browserTools(
      [{ id: "shop", name: "Shop", type: "web", authentication: { method: "none" }, environments: [{ name: "local", uiUrl: site.origin }] }],
      {
        environment: "local",
        env: {},
        screenshotsDir: screenshots,
      },
    );
    try {
      const events = await withRuntime({ kind: "live", upstream: { baseUrl: server.baseUrl } }, MODEL, (runtime) =>
        exchange(runtime, { instructions: "Explore.", tools: toolset.tools, limits: { maxIterations: null, maxDurationMs: null, maxActions: 1 } }, "Go."),
      );
      const last = events.at(-1);
      assert.equal(last?.type, "stopped");
      assert.deepEqual(last?.type === "stopped" && [last.reason.limit, last.reason.counters.actions], ["actions", 1]);
      assert.deepEqual(
        events.filter((e) => e.type === "tool-result").map((e) => e.type === "tool-result" && e.callId),
        ["c1", "s1", "s2"],
      );
    } finally {
      await toolset.close();
      await server.close();
      await site.close();
      rmSync(screenshots, { recursive: true, force: true });
    }
  });
});
