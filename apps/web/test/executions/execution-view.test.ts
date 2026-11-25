import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ExecutionResult } from "@open-qa-stack/domain/sessions";
import { EXECUTION_VIEWS, isExecutionView, openingView, shownIn } from "../../src/executions/execution-view.ts";

const result = (title: string, verdict: ExecutionResult["verdict"], previous?: ExecutionResult["previous"]): ExecutionResult => ({
  path: "a.spec.ts",
  title,
  project: "shop",
  verdict,
  durationMs: 1,
  ...(previous === undefined ? {} : { previous }),
});

const RESULTS = [
  result("new", "failed", "passed"),
  result("still", "failed", "failed"),
  result("first", "failed"),
  result("fixed", "passed", "failed"),
  result("flaky", "flaky", "passed"),
  result("fixed flaky", "flaky", "failed"),
  result("passed", "passed", "passed"),
  result("skipped", "skipped", "failed"),
];

describe("the views of an execution", () => {
  it("show the tests to look at, every one, the new failures, those fixed, or those that passed on a retry", () => {
    assert.deepEqual(Object.fromEntries(EXECUTION_VIEWS.map((view) => [view, shownIn(RESULTS, view).map(({ title }) => title)])), {
      attention: ["new", "still", "first", "fixed", "fixed flaky"],
      all: RESULTS.map(({ title }) => title),
      new_failures: ["new"],
      fixed: ["fixed", "fixed flaky"],
      flaky: ["flaky", "fixed flaky"],
    });
  });

  it("open on the tests to look at, or on every one when there is none to", () => {
    assert.equal(openingView(RESULTS), "attention");
    assert.equal(openingView([result("passed", "passed")]), "all");
  });

  it("are those an address may name", () => {
    assert.deepEqual([isExecutionView("fixed"), isExecutionView("toString"), isExecutionView(undefined)], [true, false, false]);
  });
});
