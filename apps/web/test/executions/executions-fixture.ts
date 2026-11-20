import type { Execution } from "@open-qa-stack/domain/sessions";

/** The path of the test of the detail of a policy. */
export const DETAIL = "apps/policy-management/tests/policies/policy-detail/policy-detail-nominal.spec.ts";

/** Two executions of the tests of Lakeside Mutual, the latest first: one of each verdict, then a past run without a version nor a test. */
export const EXECUTIONS: readonly Execution[] = [
  {
    id: "5b0c8f2e-6a51-4d1e-9a3f-2c7d1e0b9a44",
    origin: "design",
    sessionId: "8d3f1a52-0c4e-4b8a-9e61-7f2a5c9d0b13",
    ranAt: "2026-11-19T10:00:05.000Z",
    commit: "4f2a9c01d3b6e8a7f5c2d1e0b9a8c7d6e5f4a3b2",
    report: ".oqas/runs/run-2026-11-19T10-00-00-000Z/report.json",
    results: [
      { path: DETAIL, title: "Display the detail of a policy", project: "policy-management", verdict: "passed", durationMs: 2140, fileDigest: "9f86d0" },
      {
        path: DETAIL,
        title: "Policies › Edit a policy",
        project: "policy-management",
        verdict: "failed",
        durationMs: 5300,
        failure: {
          step: { number: 3, title: "Save the policy" },
          message: "Error: expect(locator).toHaveText(expected) failed",
          expected: '"Saved"',
          received: '"Refused"',
        },
      },
      { path: DETAIL, title: "Policies › Filter the policies", project: "policy-management", verdict: "flaky", durationMs: 800 },
      { path: DETAIL, title: "Policies › Delete a policy", project: "policy-management", verdict: "skipped", durationMs: 0 },
      { path: DETAIL, title: "Policies › Print a policy", project: "policy-management", verdict: "passed", durationMs: 1000 },
    ],
  },
  {
    id: "run-2026-11-18T22-15-30-250Z",
    origin: "design",
    ranAt: "2026-11-18T22:15:30.250Z",
    report: ".oqas/runs/run-2026-11-18T22-15-30-250Z/report.json",
    results: [],
  },
];
