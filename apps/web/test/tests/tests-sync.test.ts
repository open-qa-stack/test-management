import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { ApiClient } from "../../src/api/api-client.ts";
import type { TestsAction } from "../../src/tests/tests-state.ts";
import { LIST_PAUSE_MS, TestsSync } from "../../src/tests/tests-sync.ts";
import { FakeDocument } from "../api/fake-document.ts";
import { TESTS } from "./tests-fixture.ts";

describe("what keeps the screen of the tests in step with their instance", () => {
  let answer: () => Response;
  const told: TestsAction[] = [];
  const calls: string[] = [];
  const sync = new TestsSync(
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

  it("lists the tests of the repository again and again, and says when the instance cannot list them", async () => {
    answer = () => new Response(JSON.stringify({ items: TESTS }));
    const stop = sync.read();
    await vi.advanceTimersByTimeAsync(0);
    assert.deepEqual([calls, told], [["GET /api/tests"], [{ type: "listed", tests: TESTS }]]);
    answer = () => new Response(JSON.stringify({ code: "unavailable", detail: "Down." }), { status: 503 });
    await vi.advanceTimersByTimeAsync(LIST_PAUSE_MS);
    assert.equal(told.at(-1)!.type, "unread");
    stop();
    await vi.advanceTimersByTimeAsync(LIST_PAUSE_MS);
    assert.equal(calls.length, 2);
  });
});
