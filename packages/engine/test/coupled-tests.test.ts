import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { DesignedTest } from "@open-qa-stack/agents";
import { coupledBrief, coupledTests } from "../src/run/coupled-tests.ts";

/** A test of a design, with the verdict of its last run while it was written. */
const designed = (path: string, verdict: DesignedTest["verdict"]): DesignedTest => ({ path, scenario: path, verdict, classes: [], runs: [] });

describe("the tests coupled to the data", () => {
  it("are those that passed when written and failed in the suite, with the reasons of their failed cases", () => {
    const tests = [
      designed("apps/shop/tests/orders/list.spec.ts", "passed"),
      designed("apps/shop/tests/orders/create.spec.ts", "passed"),
      designed("apps/shop/tests/orders/gone.spec.ts", "failed"),
    ];
    const verdicts = [
      { id: "chromium › orders/list.spec.ts:4 › lists › the orders", verdict: "failed" as const, reason: "Expected 1-1 of 1." },
      { id: "chromium › orders/list.spec.ts:12 › lists › the first", verdict: "failed" as const, reason: "Expected row 1." },
      { id: "chromium › orders/create.spec.ts:3 › creates", verdict: "passed" as const, reason: "" },
      { id: "chromium › orders/gone.spec.ts:3 › follows", verdict: "failed" as const, reason: "Not found." },
      { id: "malformed", verdict: "failed" as const, reason: "No file." },
    ];
    assert.deepEqual(coupledTests(tests, verdicts), [{ path: "apps/shop/tests/orders/list.spec.ts", reason: "Expected 1-1 of 1. Expected row 1." }]);
  });

  it("are asked for repair by a brief that names them and says why", () => {
    assert.equal(
      coupledBrief([
        { path: "a.spec.ts", reason: "x" },
        { path: "b.spec.ts", reason: "y" },
      ]),
      "Repair the tests a.spec.ts, b.spec.ts: each passed alone when it was written, and failed when the whole suite ran, after the tests that change the data.",
    );
  });

  it("match a test named by its file alone", () => {
    const verdicts = [{ id: "chromium › list.spec.ts:1 › lists", verdict: "failed" as const, reason: "r" }];
    assert.deepEqual(coupledTests([designed("list.spec.ts", "passed")], verdicts), [{ path: "list.spec.ts", reason: "r" }]);
  });
});
