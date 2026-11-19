import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { ApiClient } from "../../src/api/api-client.ts";
import type { ExecutionsAction } from "../../src/executions/executions-state.ts";
import { EXECUTIONS_PAUSE_MS, ExecutionsSync } from "../../src/executions/executions-sync.ts";
import { FakeDocument } from "../api/fake-document.ts";
import { EXECUTIONS } from "./executions-fixture.ts";

describe("what keeps the screen of the executions in step with their instance", () => {
  let answer: () => Response;
  const told: ExecutionsAction[] = [];
  const calls: string[] = [];
  const sync = new ExecutionsSync(
    new ApiClient(async (input, init) => {
      calls.push(`${init?.method ?? "GET"} ${input}`);
      return answer();
    }),
    (action) => told.push(action),
  );

  beforeEach(() => {
    told.length = 0;
    calls.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("document", new FakeDocument());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("lists the executions again and again, and says when the instance cannot list them", async () => {
    answer = () => new Response(JSON.stringify({ items: EXECUTIONS }));
    const stop = sync.read();
    await vi.advanceTimersByTimeAsync(0);
    assert.deepEqual([calls, told], [["GET /api/executions"], [{ type: "listed", executions: EXECUTIONS }]]);
    answer = () => new Response(JSON.stringify({ code: "unavailable", detail: "Down." }), { status: 503 });
    await vi.advanceTimersByTimeAsync(EXECUTIONS_PAUSE_MS);
    assert.equal(told.at(-1)!.type, "unread");
    stop();
    await vi.advanceTimersByTimeAsync(EXECUTIONS_PAUSE_MS);
    assert.equal(calls.length, 2);
  });
});
