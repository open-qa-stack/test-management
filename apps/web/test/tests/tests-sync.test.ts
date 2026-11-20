import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { TestsAction } from "../../src/tests/tests-state.ts";
import { LIST_PAUSE_MS, TestsSync } from "../../src/tests/tests-sync.ts";
import { useFakeBrowser } from "../api/fake-browser.ts";
import { PlayedInstance } from "../api/played-instance.ts";
import { TESTS } from "./tests-fixture.ts";

describe("what keeps the screen of the tests in step with their instance", () => {
  const instance = new PlayedInstance<TestsAction>();
  const sync = new TestsSync(instance.client, instance.tell);
  useFakeBrowser();
  beforeEach(() => instance.reset());

  it("lists the tests of the repository again and again, and says when the instance cannot list them", async () => {
    instance.answer = () => new Response(JSON.stringify({ items: TESTS }));
    const stop = sync.read();
    await vi.advanceTimersByTimeAsync(0);
    assert.deepEqual([instance.calls, instance.told], [["GET /api/tests"], [{ type: "listed", tests: TESTS }]]);
    instance.answer = () => new Response(JSON.stringify({ code: "unavailable", detail: "Down." }), { status: 503 });
    await vi.advanceTimersByTimeAsync(LIST_PAUSE_MS);
    assert.equal(instance.told.at(-1)!.type, "unread");
    stop();
    await vi.advanceTimersByTimeAsync(LIST_PAUSE_MS);
    assert.equal(instance.calls.length, 2);
  });
});
