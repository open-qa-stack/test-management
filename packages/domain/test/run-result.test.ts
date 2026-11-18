import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ExitCode, sessionResultOf } from "../src/index.ts";

describe("what a run came to, read from the state it wrote", () => {
  it("is what the state holds, the requests to the model summed over its steps, a verdict that is none read as indeterminate", () => {
    const tests = [
      { id: "orders.spec.ts:3", verdict: "passed", reason: "The order is placed." },
      { id: "orders.spec.ts:19", verdict: "blocked", reason: "The shop answers 500." },
    ];
    const result = sessionResultOf({
      environment: "local",
      brief: "test the search of a customer",
      exitCode: 1,
      durationMs: 65_000,
      branch: "oqas/orders",
      steps: [{ step: "cartography", modelRequests: 4 }, { step: "skipped" }, null, { step: "design", modelRequests: 9 }],
      tests: [
        ...tests,
        { id: "orders.spec.ts:40", verdict: "passed" },
        "orders.spec.ts:50",
        null,
        { id: "orders.spec.ts:60", verdict: "flaky", reason: "It passed once." },
        { id: "orders.spec.ts:70", verdict: 1, reason: "It says a number." },
        { id: "orders.spec.ts:80", reason: "It says nothing." },
        { verdict: "passed", reason: "It names no test." },
      ],
    });
    assert.deepEqual(result, {
      outcome: "failed",
      durationMs: 65_000,
      modelRequests: 13,
      branch: "oqas/orders",
      tests: [
        ...tests,
        { id: "orders.spec.ts:60", verdict: "indeterminate", reason: "It passed once." },
        { id: "orders.spec.ts:70", verdict: "indeterminate", reason: "It says a number." },
        { id: "orders.spec.ts:80", verdict: "indeterminate", reason: "It says nothing." },
      ],
    });
  });

  it("lacks what the state does not hold, or holds in another form, as a run that did not go to its end", () => {
    const nothing = { outcome: "stopped", durationMs: 0, modelRequests: 0, tests: [] };
    assert.deepEqual(sessionResultOf({}), nothing);
    assert.deepEqual(sessionResultOf({ steps: "none", tests: "none", durationMs: "long", branch: 3 }), nothing);
  });

  it("knows every verdict the harness pronounces", () => {
    const verdicts = ["passed", "failed", "blocked", "indeterminate", "skipped", "not_run"];
    assert.deepEqual(
      sessionResultOf({ tests: verdicts.map((verdict) => ({ id: verdict, verdict, reason: "" })) }).tests.map(({ verdict }) => verdict),
      verdicts,
    );
  });

  for (const [exitCode, outcome] of [
    [ExitCode.passed, "passed"],
    [ExitCode.failed, "failed"],
    [ExitCode.unsettled, "inconclusive"],
    [ExitCode.configuration, "stopped"],
    [ExitCode.prerequisite, "stopped"],
    [ExitCode.interrupted, "stopped"],
    [130, "stopped"],
    ["0", "stopped"],
    [null, "stopped"],
  ] as const) {
    it(`is ${outcome} when the run ended with ${JSON.stringify(exitCode)}`, () => {
      assert.equal(sessionResultOf({ exitCode }).outcome, outcome);
    });
  }
});

describe("the codes a run ends with", () => {
  it("are six, from 0, in the order a run can fail earlier", () => {
    assert.deepEqual(ExitCode, { passed: 0, failed: 1, unsettled: 2, configuration: 3, prerequisite: 4, interrupted: 5 });
  });
});
