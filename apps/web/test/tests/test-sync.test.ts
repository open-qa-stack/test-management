import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { ApiClient } from "../../src/api/api-client.ts";
import type { TestAction } from "../../src/tests/test-state.ts";
import { READ_PAUSE_MS, TestSync } from "../../src/tests/test-sync.ts";
import { FakeDocument } from "../api/fake-document.ts";
import { READING } from "./tests-fixture.ts";

describe("what keeps the screen of a test in step with its instance", () => {
  let answer: () => Response;
  const told: TestAction[] = [];
  const calls: string[] = [];
  const sync = new TestSync(
    new ApiClient(async (input) => {
      calls.push(String(input));
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

  it("reads the test of its path again and again, and says when the instance cannot read it", async () => {
    answer = () => new Response(JSON.stringify(READING));
    const stop = sync.read(READING.path);
    await vi.advanceTimersByTimeAsync(0);
    assert.deepEqual(calls, [`/api/tests/reading?path=${encodeURIComponent(READING.path)}`]);
    assert.deepEqual(told, [{ type: "read", reading: READING }]);
    answer = () => new Response(JSON.stringify({ code: "unavailable", detail: "Down." }), { status: 503 });
    await vi.advanceTimersByTimeAsync(READ_PAUSE_MS);
    assert.equal(told.at(-1)!.type, "unread");
    stop();
  });
});
