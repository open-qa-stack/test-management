import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { TestAction } from "../../src/tests/test-state.ts";
import { READ_PAUSE_MS, TestSync } from "../../src/tests/test-sync.ts";
import { useFakeBrowser } from "../api/fake-browser.ts";
import { PlayedInstance } from "../api/played-instance.ts";
import { READING } from "./tests-fixture.ts";

describe("what keeps the screen of a test in step with its instance", () => {
  const instance = new PlayedInstance<TestAction>();
  const sync = new TestSync(instance.client, instance.tell);
  useFakeBrowser();
  beforeEach(() => instance.reset());

  it("reads the test of its path again and again, and says when the instance cannot read it", async () => {
    instance.answer = () => new Response(JSON.stringify(READING));
    const stop = sync.read(READING.path);
    await vi.advanceTimersByTimeAsync(0);
    assert.deepEqual(instance.calls, [`GET /api/tests/reading?path=${encodeURIComponent(READING.path)}`]);
    assert.deepEqual(instance.told, [{ type: "read", reading: READING }]);
    instance.answer = () => new Response(JSON.stringify({ code: "unavailable", detail: "Down." }), { status: 503 });
    await vi.advanceTimersByTimeAsync(READ_PAUSE_MS);
    assert.equal(instance.told.at(-1)!.type, "unread");
    stop();
  });
});
