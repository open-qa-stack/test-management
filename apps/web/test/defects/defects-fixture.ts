import type { DefectList, ListedDefect } from "@open-qa-stack/domain/sessions";

const TEST = { path: "apps/policy-management/tests/policies/policy-detail/policy-detail.spec.ts", title: "Display the detail of a policy" };

/** A defect to deal with, the most serious. */
export const BLOCKING: ListedDefect = {
  id: "D-3",
  title: "The premium shows 0",
  severity: "S1",
  description: "Failed step: 2. Open the policy",
  test: TEST,
  execution: "e1",
  status: "open",
  openedAt: "2026-11-26T09:00:00.000Z",
  stage: "open",
};

/** A defect fixed, whose test is to run again. */
export const FIXED: ListedDefect = {
  ...BLOCKING,
  id: "D-2",
  title: "The dates are swapped",
  severity: "S3",
  status: "fixed",
  fixedAt: "2026-11-26T10:00:00.000Z",
  stage: "to_replay",
};

/** A defect fixed whose test passed since, and one closed. */
export const REPLAYED: ListedDefect = { ...FIXED, id: "D-1", title: "The name is cut", severity: "S4", stage: "replayed" };
export const CLOSED: ListedDefect = {
  ...BLOCKING,
  id: "D-0",
  title: "A typo",
  severity: "S2",
  status: "closed",
  closedAt: "2026-11-26T11:00:00.000Z",
  stage: "closed",
};

/** The defects of the instance, and how many each view holds. */
export const DEFECTS: DefectList = { items: [BLOCKING, FIXED, REPLAYED, CLOSED], counts: { open: 1, toReplay: 1, closed: 2 } };
