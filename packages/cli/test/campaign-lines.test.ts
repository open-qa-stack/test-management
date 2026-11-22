import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { Campaign } from "@open-qa-stack/domain";
import { overviewLine, progressLines } from "../src/solo/campaign-lines.ts";

const PATH = "apps/shop/tests/orders/search.spec.ts";
const CAMPAIGN: Campaign = {
  id: "c1",
  name: "Release 1",
  environment: "staging",
  status: "in_progress",
  createdAt: "2026-11-22T08:00:00.000Z",
  tests: [{ path: PATH, title: "search" }],
};

describe("a campaign, as a command writes it", () => {
  it("counts the verdicts its tests came to, in the order a person reads them, leaving out those none came to", () => {
    assert.equal(
      overviewLine({ ...CAMPAIGN, counts: { passed: 3, flaky: 1, failed: 2, skipped: 0, not_run: 4 } }),
      "c1  Release 1  in progress  staging  1 test: 3 passed, 1 passed on a retry, 2 failed, 4 not run",
    );
  });

  it("tells each of its tests with the verdict it came to, and the execution that gave it", () => {
    assert.deepEqual(progressLines({ campaign: CAMPAIGN, results: [{ path: PATH, title: "search", verdict: "flaky", execution: "e1" }] }), [
      "c1  Release 1  in progress  staging  1 test",
      `flaky   ${PATH} › search, execution e1`,
    ]);
  });
});
