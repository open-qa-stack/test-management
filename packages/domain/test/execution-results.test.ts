import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { executionResults, reportEntries } from "../src/index.ts";

/** A test of a report, in the project of the shop, with the attempts given. */
const test = (status: string, durations: readonly (number | undefined)[]) => ({
  projectName: "shop",
  status,
  expectedStatus: "passed",
  results: durations.map((duration) => ({ status: "passed", ...(duration === undefined ? {} : { duration }) })),
});

/** A report of the orders of the shop: one test at the root of its file, three in a `describe` nested in another. */
const REPORT = JSON.stringify({
  suites: [
    {
      title: "orders/search.spec.ts",
      file: "orders/search.spec.ts",
      specs: [{ title: "Search an order", file: "orders/search.spec.ts", line: 3, tests: [test("expected", [120])] }],
      suites: [
        {
          title: "Orders",
          file: "orders/search.spec.ts",
          suites: [
            {
              title: "Filters",
              file: "orders/search.spec.ts",
              specs: [
                { title: "Filter by date", file: "orders/search.spec.ts", line: 9, tests: [test("unexpected", [40, 60])] },
                { title: "Filter by state", file: "orders/search.spec.ts", line: 14, tests: [test("flaky", [30, undefined])] },
                { title: "Filter by shop", file: "orders/search.spec.ts", line: 19, tests: [test("skipped", [])] },
              ],
            },
          ],
        },
      ],
    },
  ],
});

describe("what came of each test of an execution, from the report of the runner", () => {
  it("names each test by the path of its file in the test repository and by its titles, with its project, its verdict and how long its attempts took", () => {
    assert.deepEqual(executionResults(REPORT, "apps"), [
      { path: "apps/orders/search.spec.ts", title: "Search an order", project: "shop", verdict: "passed", durationMs: 120 },
      { path: "apps/orders/search.spec.ts", title: "Orders › Filters › Filter by date", project: "shop", verdict: "failed", durationMs: 100 },
      { path: "apps/orders/search.spec.ts", title: "Orders › Filters › Filter by state", project: "shop", verdict: "flaky", durationMs: 30 },
      { path: "apps/orders/search.spec.ts", title: "Orders › Filters › Filter by shop", project: "shop", verdict: "skipped", durationMs: 0 },
    ]);
  });

  it("gives each test of a report the titles that name it, without its project nor its line", () => {
    assert.deepEqual(
      reportEntries(REPORT)?.map(({ id, title }) => [id, title]),
      [
        ["shop › orders/search.spec.ts:3 › Search an order", "Search an order"],
        ["shop › orders/search.spec.ts:9 › Orders › Filters › Filter by date", "Orders › Filters › Filter by date"],
        ["shop › orders/search.spec.ts:14 › Orders › Filters › Filter by state", "Orders › Filters › Filter by state"],
        ["shop › orders/search.spec.ts:19 › Orders › Filters › Filter by shop", "Orders › Filters › Filter by shop"],
      ],
    );
  });

  it("reads nothing from a text that is not a report", () => {
    assert.equal(executionResults("not json", "apps"), undefined);
  });
});
