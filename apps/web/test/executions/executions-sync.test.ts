import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { ExecutionsAction } from "../../src/executions/executions-state.ts";
import { EXECUTIONS_PAUSE_MS, ExecutionsSync } from "../../src/executions/executions-sync.ts";
import { useFakeBrowser } from "../api/fake-browser.ts";
import { PlayedInstance } from "../api/played-instance.ts";
import { EXECUTIONS } from "./executions-fixture.ts";

describe("what keeps the screen of the executions in step with their instance", () => {
  const instance = new PlayedInstance<ExecutionsAction>();
  const sync = new ExecutionsSync(instance.client, instance.tell);
  useFakeBrowser();
  beforeEach(() => instance.reset());

  it("lists the executions again and again, and says when the instance cannot list them", async () => {
    instance.answer = () => new Response(JSON.stringify({ items: EXECUTIONS }));
    const stop = sync.read();
    await vi.advanceTimersByTimeAsync(0);
    assert.deepEqual([instance.calls, instance.told], [["GET /api/executions"], [{ type: "listed", executions: EXECUTIONS }]]);
    instance.answer = () => new Response(JSON.stringify({ code: "unavailable", detail: "Down." }), { status: 503 });
    await vi.advanceTimersByTimeAsync(EXECUTIONS_PAUSE_MS);
    assert.equal(instance.told.at(-1)!.type, "unread");
    stop();
    await vi.advanceTimersByTimeAsync(EXECUTIONS_PAUSE_MS);
    assert.equal(instance.calls.length, 2);
  });
});
