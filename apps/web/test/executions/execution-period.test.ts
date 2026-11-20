import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { EXECUTION_PERIODS, isExecutionPeriod, periodStart } from "../../src/executions/execution-period.ts";
import { executionsHref } from "../../src/executions/executions-paths.ts";

describe("the period of a page of the executions", () => {
  it("is the last day, seven days or thirty days, and nothing else", () => {
    assert.deepEqual(EXECUTION_PERIODS, ["day", "week", "month"]);
    assert.deepEqual(["day", "week", "month", "year", "", undefined].map(isExecutionPeriod), [true, true, true, false, false, false]);
  });

  it("starts as many days before the moment it is read at", () => {
    const now = new Date("2026-11-20T10:30:00.000Z");
    assert.deepEqual(
      EXECUTION_PERIODS.map((period) => periodStart(period, now)),
      ["2026-11-19T10:30:00.000Z", "2026-11-13T10:30:00.000Z", "2026-10-21T10:30:00.000Z"],
    );
  });

  it("is kept by the address of a page, with its outcome and the execution it starts after", () => {
    assert.deepEqual(
      [executionsHref(), executionsHref({ period: "day" }), executionsHref({ outcome: "passing", period: "month" }, "e1")],
      ["#/executions", "#/executions?period=day", "#/executions?outcome=passing&period=month&before=e1"],
    );
  });
});
