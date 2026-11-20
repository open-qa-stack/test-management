import type { Campaign, CampaignOverview, CampaignProgress } from "@open-qa-stack/domain/sessions";

/** A test of the policies, as a campaign fixes it. */
export const POLICY = { path: "apps/policy-management/tests/policies/policy-detail.spec.ts", title: "Display the detail of a policy" };

/** A test of the quotes, as a campaign fixes it. */
export const QUOTE = { path: "apps/policy-management/tests/insurance-quotes/quote-answer.spec.ts", title: "Answer an insurance quote" };

/** A campaign that runs, launched once. */
export const RUNNING: Campaign = {
  id: "c1",
  name: "Recette 4.2",
  environment: "local",
  scope: { tags: ["@p0", "@domain-policies"] },
  status: "in_progress",
  createdAt: "2026-11-20T08:00:00.000Z",
  readyAt: "2026-11-20T08:05:00.000Z",
  tests: [QUOTE, POLICY],
};

/** A campaign planned, with no tag: it takes every test. */
export const PLANNED: Campaign = {
  id: "c2",
  name: "Tout le dépôt",
  environment: "local",
  scope: { tags: [] },
  status: "planned",
  createdAt: "2026-11-20T09:00:00.000Z",
  tests: [],
};

/** What came of the tests of the campaign that runs: one passed, one not run. */
export const PROGRESS: CampaignProgress = {
  campaign: RUNNING,
  results: [
    { ...QUOTE, verdict: "failed", execution: "e1", ranAt: "2026-11-20T08:10:00.000Z" },
    { ...POLICY, verdict: "not_run" },
  ],
};

/** The campaigns as their list gives them: the one planned, which takes three tests, then the one that runs. */
export const OVERVIEWS: readonly CampaignOverview[] = [
  { ...PLANNED, counts: { passed: 0, failed: 0, flaky: 0, skipped: 0, not_run: 3 } },
  { ...RUNNING, counts: { passed: 0, failed: 1, flaky: 0, skipped: 0, not_run: 1 } },
];
