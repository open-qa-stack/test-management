import type { RepositoryTest, TestReading } from "@open-qa-stack/domain/sessions";

/** A functional test of the policies, as a design writes it. */
export const DETAIL: RepositoryTest = {
  path: "apps/policy-management/tests/policies/policy-detail/policy-detail-nominal.spec.ts",
  title: "Display the detail of a policy",
  steps: ["1. Open the policy of the customer", "2. Read its amounts"],
  tags: ["@level-functional", "@domain-policies", "@feature-policy-detail", "@app-policy-management", "@kind-functional", "@case-nominal", "@data-read"],
  applications: ["policy-management"],
  level: "functional",
  domain: "policies",
  feature: "policy-detail",
  kind: "functional",
  case: "nominal",
  data: "read",
};

/** The code of the file of the test of the policies. */
export const SOURCE = [
  'import { expect, test } from "../../../../shared/fixtures.ts";',
  "",
  'test("Display the detail of a policy", { tag: ["@level-functional", "@app-policy-management"] }, async ({ page }) => {',
  '  await test.step("1. Open the policy of the customer", async () => {',
  '    await page.goto("/policies/fvh1p2pmkx");',
  "  });",
  '  await test.step("2. Read its amounts", async () => {',
  '    await expect(page.getByText("CHF 1,200.00")).toBeVisible();',
  "  });",
  "});",
  "",
].join("\n");

/** A visual test of the same application. */
export const SCREEN: RepositoryTest = {
  ...DETAIL,
  path: "apps/policy-management/tests/policies/policy-edit/policy-edit-form-screen.spec.ts",
  title: "Compare the edit form of a policy",
  steps: ["1. Open the edit form"],
  tags: ["@level-functional", "@domain-policies", "@feature-policy-edit", "@app-policy-management", "@kind-visual", "@case-nominal", "@data-read"],
  kind: "visual",
  feature: "policy-edit",
};

/** A smoke test of another application, which crosses none. */
export const SMOKE: RepositoryTest = {
  path: "apps/customer-management/tests/customers/application-load/customer-management-smoke.spec.ts",
  title: "Customer Management answers",
  steps: ["1. Open the home page"],
  tags: ["@level-smoke", "@app-customer-management"],
  applications: ["customer-management"],
  level: "smoke",
};

/** A test written by hand, without a tag. */
export const HANDMADE: RepositoryTest = { path: "apps/scratch.spec.ts", title: "A test by hand", steps: [], tags: [], applications: [] };

/** Every test of the fixtures, in the order of their paths. */
export const TESTS: readonly RepositoryTest[] = [SMOKE, DETAIL, SCREEN, HANDMADE].sort((left, right) => left.path.localeCompare(right.path));

/** The test of the policies read in steps, from a run where its second step failed. */
export const READING: TestReading = {
  path: DETAIL.path,
  run: "run-2026-11-19T00-29-03-488Z",
  view: {
    id: `policy-management › policy-management/tests/policies/policy-detail/policy-detail-nominal.spec.ts:3 › ${DETAIL.title}`,
    status: "unexpected",
    steps: [
      {
        number: 1,
        title: "1. Open the policy of the customer",
        state: "passed",
        duration: 224,
        capture: { name: "1", contentType: "image/png" },
        steps: [{ title: "Fill the search", state: "passed", duration: 12, steps: [] }],
      },
      { number: 2, title: "2. Read its amounts", state: "failed", duration: 5012, steps: [] },
    ],
    failedStep: 2,
    expected: '"1500 CHF"',
    received: '"250 CHF"',
    uncaptured: [2],
    details: {
      error: "Error: expect(locator).toHaveText()",
      stack: "at policy-detail-nominal.spec.ts:9",
      stdout: ["opened\n"],
      stderr: [],
      trace: "/work/.oqas/test-results/trace.zip",
      screenshots: [],
    },
  },
};
