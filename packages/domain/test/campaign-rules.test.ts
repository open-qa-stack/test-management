import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { campaignCounts, campaignResults, campaignTransition, CampaignRefusedError, scopedTests, type CampaignStatus, type Execution } from "../src/index.ts";

const STATES: readonly CampaignStatus[] = ["planned", "ready", "in_progress", "closed"];

describe("the life of a campaign", () => {
  it("takes exactly three changes, from planned to ready, then in_progress, then closed, and none from closed", () => {
    const allowed = STATES.flatMap((from) =>
      STATES.flatMap((to) => {
        try {
          campaignTransition(from, to);
          return [`${from} → ${to}`];
        } catch (error) {
          assert.ok(error instanceof CampaignRefusedError && error.message.startsWith(`A campaign ${from} cannot become ${to}: `));
          return [];
        }
      }),
    );
    assert.deepEqual(allowed, ["planned → ready", "ready → in_progress", "in_progress → closed"]);
  });
});

describe("the tests a scope takes", () => {
  const tests = [
    { path: "b.spec.ts", title: "B", tags: ["@p1"] },
    { path: "a.spec.ts", title: "A", tags: ["@p0", "@domain-quotes"] },
    { path: "a.spec.ts", title: "0", tags: [] },
  ];

  it("are those that bear one of its tags, in the order of their paths then their titles, without their tags", () => {
    assert.deepEqual(scopedTests({ tags: ["@domain-quotes", "@p1"] }, tests), [
      { path: "a.spec.ts", title: "A" },
      { path: "b.spec.ts", title: "B" },
    ]);
    assert.deepEqual(scopedTests({ tags: ["@p3"] }, tests), []);
  });

  it("are every test when it names no tag", () => {
    assert.deepEqual(
      scopedTests({ tags: [] }, tests).map(({ title }) => title),
      ["0", "A", "B"],
    );
  });
});

describe("what came of each test of a campaign", () => {
  const execution = (id: string, ranAt: string, verdicts: Record<string, "passed" | "failed">): Execution => ({
    id,
    origin: "campaign",
    campaignId: "c1",
    ranAt,
    report: `${id}.json`,
    results: Object.entries(verdicts).map(([path, verdict]) => ({ path, title: path, project: "shop", verdict, durationMs: 1 })),
  });

  it("is its verdict in the latest execution that ran its file, whatever their order, or not_run", () => {
    const first = execution("e1", "2026-11-20T08:00:00.000Z", { "a.spec.ts": "failed", "b.spec.ts": "failed" });
    const second = execution("e2", "2026-11-20T09:00:00.000Z", { "a.spec.ts": "passed" });
    assert.deepEqual(
      campaignResults(
        [
          { path: "a.spec.ts", title: "A" },
          { path: "b.spec.ts", title: "B" },
          { path: "c.spec.ts", title: "C" },
        ],
        [first, second],
      ),
      [
        { path: "a.spec.ts", title: "A", verdict: "passed", execution: "e2", ranAt: second.ranAt },
        { path: "b.spec.ts", title: "B", verdict: "failed", execution: "e1", ranAt: first.ranAt },
        { path: "c.spec.ts", title: "C", verdict: "not_run" },
      ],
    );
  });
});

describe("the counts of a campaign", () => {
  it("tell how many of its tests came to each verdict, and how many were not run", () => {
    const test = { path: "a.spec.ts", title: "A" };
    assert.deepEqual(
      campaignCounts([
        { ...test, verdict: "passed" },
        { ...test, verdict: "passed" },
        { ...test, verdict: "flaky" },
        { ...test, verdict: "not_run" },
      ]),
      { passed: 2, failed: 0, flaky: 1, skipped: 0, not_run: 1 },
    );
  });
});
