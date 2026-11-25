import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { Execution, QaView } from "@open-qa-stack/domain";
import { anomalyLine, executionLines, executionPageLines, readingLines, testExecutionLine, testLine, versionLine } from "../../src/output/test-lines.ts";

const PATH = "apps/shop/tests/orders/search.spec.ts";
const AT = "2026-11-22T08:00:00.000Z";

/** An execution of a campaign, at no commit, where a test failed at a step and another failed without a word of why. */
const CAMPAIGN: Execution = {
  id: "e2",
  origin: "campaign",
  campaignId: "c1",
  ranAt: AT,
  report: ".oqas/runs/run/report.json",
  results: [
    {
      path: PATH,
      title: "search",
      project: "shop",
      verdict: "failed",
      durationMs: 9,
      version: 2,
      failure: { step: { number: 2, title: "2. Search" }, message: "none found" },
    },
    { path: PATH, title: "filter", project: "shop", verdict: "failed", durationMs: 9, failure: {} },
    { path: PATH, title: "sort", project: "shop", verdict: "flaky", durationMs: 9, failure: { message: "timed out" } },
  ],
};

describe("the tests and the executions, as a command writes them", () => {
  it("name a test by its file, its titles and the tags it is sorted by, and say what keeps a file from being listed", () => {
    assert.equal(testLine({ path: PATH, title: "search", steps: [], tags: [], applications: ["shop"] }), `${PATH} › search`);
    assert.equal(
      anomalyLine({ kind: "duplicate", path: PATH, title: "search" }),
      `${PATH}: two tests share the title "search", which the runner and the results take as one test.`,
    );
    assert.equal(anomalyLine({ kind: "unreadable", path: PATH }), `${PATH}: a syntax error keeps every test of the file from being read.`);
  });

  it("read a test that passed on a retry, with what its failed assertion expected and received, and without a trace", () => {
    const view = {
      id: "x",
      status: "flaky",
      steps: [],
      expected: "3 rows",
      received: "2 rows",
      uncaptured: [],
      details: { stdout: [], stderr: [], screenshots: [] },
    } as QaView;
    assert.deepEqual(readingLines({ path: PATH, run: "run-1", ranAt: AT, view, traced: false }), [
      `${PATH}, as the run run-1 of ${AT} ran it: passed on a retry.`,
      "Expected: 3 rows",
      "Received: 2 rows",
      "No trace of it is kept.",
    ]);
  });

  it("tell an execution of a campaign, each test with its version, and where and why a test failed when the report says it", () => {
    assert.deepEqual(executionLines(CAMPAIGN), [
      `e2  campaign, campaign c1  ${AT}  0 of 3 tests passed.`,
      `failed  ${PATH} › search, version 2`,
      "        at step 2, 2. Search: none found",
      `failed  ${PATH} › filter`,
      `flaky   ${PATH} › sort`,
      "        timed out",
    ]);
    const {
      results: [result],
      report: _report,
      ...execution
    } = CAMPAIGN;
    assert.equal(testExecutionLine({ ...execution, result: result! }), `e2  campaign, campaign c1  ${AT}  failed  search, version 2`);
    const { version: _version, ...unversioned } = result!;
    assert.equal(
      testExecutionLine({ id: "e3", origin: "manual", ranAt: AT, environment: "local", result: unversioned }),
      `e3  manual, on local  ${AT}  failed  search`,
    );
  });

  it("say what an execution changed for a test since its last run", () => {
    const [search, filter, sort] = CAMPAIGN.results;
    const results = [
      { ...search!, failure: {}, previous: "passed" as const },
      { ...filter!, previous: "failed" as const },
      { ...sort!, failure: {}, previous: "failed" as const },
    ];
    assert.deepEqual(executionLines({ ...CAMPAIGN, results }).slice(1), [
      `failed  ${PATH} › search, version 2, new failure`,
      `failed  ${PATH} › filter, failed already`,
      `flaky   ${PATH} › sort, fixed`,
    ]);
  });

  it("say where a page stands among the executions, with how to ask for the next one", () => {
    assert.deepEqual(executionPageLines({ items: [CAMPAIGN], total: 30, start: 20, next: "e2" }), [
      `e2  campaign, campaign c1  ${AT}  0 of 3 tests passed`,
      "Executions 21 to 21 of 30; the next ones with --before e2.",
    ]);
  });

  it("name a version of a test by its number, since when it ran, how often, and the commit it was first run at", () => {
    const version = { path: PATH, title: "search", number: 2, digest: "d", since: AT, executions: 3 };
    assert.equal(versionLine(version), `version 2  search  since ${AT}  3 executions  never run committed`);
    assert.equal(versionLine({ ...version, commit: "abc" }), `version 2  search  since ${AT}  3 executions  commit abc`);
  });
});
