import type { RepositoryTest } from "@open-qa-stack/domain/sessions";

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
