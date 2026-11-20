import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { launchProgress } from "../src/index.ts";

describe("the progress of a launch", () => {
  it("is nothing before the runner started", () => {
    assert.deepEqual(launchProgress(""), { finished: [] });
  });

  it("tells how many tests run, then each one the runner finished, passing over what is not a line of progress", () => {
    const text = [
      JSON.stringify({ total: 3 }),
      JSON.stringify({ path: "apps/a.spec.ts", title: "A", verdict: "passed" }),
      "[1, 2]",
      JSON.stringify({ path: "apps/b.spec.ts", title: "B", verdict: "timedOut" }),
      JSON.stringify({ path: "apps/c.spec.ts", verdict: "failed" }),
      JSON.stringify({ path: "apps/b.spec.ts", title: "B", verdict: "flaky" }),
      '{"path": "apps/c.spec',
    ].join("\n");
    assert.deepEqual(launchProgress(text), {
      total: 3,
      finished: [
        { path: "apps/a.spec.ts", title: "A", verdict: "passed" },
        { path: "apps/b.spec.ts", title: "B", verdict: "flaky" },
      ],
    });
  });
});
