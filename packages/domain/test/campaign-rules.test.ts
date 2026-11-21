import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  campaignCounts,
  campaignResults,
  campaignTransition,
  campaignVerdict,
  CampaignRefusedError,
  chosenTests,
  type CampaignStatus,
  type Execution,
} from "../src/index.ts";

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

describe("the tests chosen for a campaign", () => {
  it("are put in the order of their paths then their titles, each once", () => {
    assert.deepEqual(
      chosenTests([
        { path: "b.spec.ts", title: "B" },
        { path: "a.spec.ts", title: "Z" },
        { path: "a.spec.ts", title: "A" },
        { path: "b.spec.ts", title: "B" },
      ]),
      [
        { path: "a.spec.ts", title: "A" },
        { path: "a.spec.ts", title: "Z" },
        { path: "b.spec.ts", title: "B" },
      ],
    );
  });
});

describe("what came of each test of a campaign", () => {
  /** An execution of the campaign, its verdicts by the path of their file then the title of their test. */
  const execution = (id: string, ranAt: string, verdicts: Record<string, "passed" | "failed">): Execution => ({
    id,
    origin: "campaign",
    campaignId: "c1",
    ranAt,
    report: `${id}.json`,
    results: Object.entries(verdicts).map(([test, verdict]) => {
      const [path, title] = test.split(" :: ") as [string, string];
      return { path, title, project: "shop", verdict, durationMs: 1 };
    }),
  });

  it("is its verdict in the latest execution that ran it, found by its file and its title, whatever their order, or not_run", () => {
    // A launch runs the files: what it ran beside the tests of the campaign does not count.
    const first = execution("e1", "2026-11-20T08:00:00.000Z", { "a.spec.ts :: A": "failed", "b.spec.ts :: B": "failed", "b.spec.ts :: Other": "passed" });
    const second = execution("e2", "2026-11-20T09:00:00.000Z", { "a.spec.ts :: A": "passed", "c.spec.ts :: Other": "passed" });
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

describe("the verdict of a campaign", () => {
  const counts = { passed: 0, failed: 0, flaky: 0, skipped: 0, not_run: 0 };

  it("passes when every test passed, at once or on a retry", () => {
    assert.equal(campaignVerdict({ ...counts, passed: 3 }), "passes");
    assert.equal(campaignVerdict({ ...counts, passed: 2, flaky: 1 }), "passes");
  });

  it("does not pass as soon as a test failed, was skipped or was not run", () => {
    for (const verdict of ["failed", "skipped", "not_run"] as const) assert.equal(campaignVerdict({ ...counts, passed: 2, [verdict]: 1 }), "fails", verdict);
  });

  it("is none for a campaign of no test", () => {
    assert.equal(campaignVerdict(counts), undefined);
  });
});
