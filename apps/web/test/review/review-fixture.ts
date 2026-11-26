import type { ReviewedTest, ReviewQueue, TestProposal } from "@open-qa-stack/domain/sessions";

/** A test of the quotes the agents wrote, which an agent reviewed. */
export const QUOTE: ReviewedTest = {
  id: "11111111-1111-4111-8111-111111111111",
  path: "apps/policy-management/tests/quotes/quote-expiry/quote-expiry.spec.ts",
  title: "A quote expires after thirty days",
  application: "policy-management",
  domain: "quotes",
  feature: "quote-expiry",
  level: "functional",
  kind: "functional",
  branch: "oqas/design-20261127T090000Z",
  designedAt: "2026-11-27T09:00:00.000Z",
  verdict: "passed",
  runs: 3,
  reviewed: true,
  remarkCount: 1,
  status: "in_review",
};

/** A test of the policies that failed because of the application, and that no agent reviewed. */
export const POLICY: ReviewedTest = {
  ...QUOTE,
  id: "22222222-2222-4222-8222-222222222222",
  path: "apps/policy-management/tests/policies/policy-edit/edit-policy.spec.ts",
  title: "Edit the dates of a policy",
  domain: "policies",
  feature: "policy-edit",
  kind: "visual",
  verdict: "failed",
  runs: 1,
  reviewed: false,
  remarkCount: 0,
};

/** A test of the quotes a person set aside. */
export const ASIDE: ReviewedTest = { ...QUOTE, id: "33333333-3333-4333-8333-333333333333", title: "List the quotes", status: "set_aside" };

/** The queue of the review: two tests to review and one set aside. */
export const QUEUE: ReviewQueue = { tests: [QUOTE, POLICY, ASIDE], counts: { inReview: 2, setAside: 1 } };

/** What a person reads of the test of the quotes. */
export const PROPOSAL: TestProposal = {
  ...QUOTE,
  brief: "The expiry of the quotes.",
  intent: "Verify that a quote older than thirty days shows as expired.",
  sources: [{ source: "policy-specs", item: "Quotes" }, { source: "policy-management" }],
  steps: [
    { action: "Open the quotes", expects: ["The quotes show"] },
    { action: "Open the quote of 1 October", expects: ["It shows Expired", "Its price is no longer shown"] },
  ],
  reason: "Its last run passed.",
  remarks: [{ about: "code", where: "line 12", what: "Use a role in place of the text.", rule: "PW-LOC-01" }],
  files: [
    { path: QUOTE.path, content: 'test("A quote expires after thirty days", async () => {});\n', added: 42 },
    { path: "apps/policy-management/pages/quotes-page.ts", content: "export class QuotesPage {}\n", added: 6 },
  ],
};
