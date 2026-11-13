import type { CharterRule } from "./charter-rule.ts";

/**
 * The default test charter, versioned with this package.
 *
 * @remarks
 * Rules are listed in the order the instructions present them. An identifier is never reused for
 * another rule; a rule that no longer holds is removed, and its identifier retired.
 */
export const DEFAULT_CHARTER: readonly CharterRule[] = Object.freeze([
  {
    id: "PW-LOC-01",
    statement: "Locate elements by role, label, text or test id: getByRole first, then getByLabel, getByText or getByTestId.",
    rationale: "These locators follow what the user perceives and survive changes to markup and styling.",
    source: "https://playwright.dev/docs/locators",
    example: `await page.getByRole("button", { name: "Save" }).click();`,
  },
  {
    id: "PW-LOC-02",
    statement: "Never locate an element by a CSS class, an XPath expression or its position in the page structure.",
    rationale: "Selectors tied to the structure of the page break whenever its markup changes, without any change for the user.",
    source: "https://playwright.dev/docs/other-locators",
    example: `await page.getByTestId("policy-summary").getByRole("link", { name: "Details" }).click();`,
  },
  {
    id: "PW-ASSERT-01",
    statement: "Assert with web-first assertions on a locator, await expect(locator), never on a value read once from the page.",
    rationale: "Web-first assertions retry until the condition holds or the timeout expires, so they wait for the application instead of racing it.",
    source: "https://playwright.dev/docs/best-practices#use-web-first-assertions",
    example: `await expect(page.getByRole("status")).toHaveText("Policy saved");`,
  },
  {
    id: "PW-WAIT-01",
    statement: "Never wait for a fixed time: no page.waitForTimeout, no timer.",
    rationale: "Tests that wait for a fixed time are inherently flaky; locators and assertions already wait for the page.",
    source: "https://playwright.dev/docs/api/class-page#page-wait-for-timeout",
    example: `await expect(page.getByRole("table", { name: "Policies" })).toBeVisible();`,
  },
  {
    id: "PW-ISO-01",
    statement:
      "Make every test independent: no state shared with another test, no reliance on the order of tests, no serial mode, and never call a test from another; share steps through exported functions or fixtures.",
    rationale: "Isolated tests can run alone, in any order and in parallel, and a failure points at one test instead of a chain.",
    source: "https://playwright.dev/docs/best-practices#make-tests-as-isolated-as-possible",
    example: `test("renews a policy", async ({ page, policy }) => {\n  await openPolicy(page, policy.id);\n});`,
  },
  {
    id: "PW-DATA-01",
    statement: "Prepare the data a test needs through the API or a fixture, never through the screens of another feature, and remove it once the test is over.",
    rationale: "Preparing data through the API is fast and reliable, and a fixture that cleans up after itself leaves nothing for the next test to trip on.",
    source: "https://playwright.dev/docs/api-testing#establish-preconditions",
    example: `const test = base.extend<{ customer: Customer }>({\n  customer: async ({ request }, use) => {\n    const customer = await createCustomer(request);\n    await use(customer);\n    await deleteCustomer(request, customer.id);\n  },\n});`,
  },
  {
    id: "PW-STEP-01",
    statement: "Wrap each business action of a test in test.step, titled in the words of the business.",
    rationale: "Steps structure the report and the trace, so a reader sees which action failed without reading the code.",
    source: "https://playwright.dev/docs/api/class-test#test-step",
    example: `await test.step("Change the delivery address", async () => {\n  await page.getByLabel("Street").fill(address.street);\n  await page.getByRole("button", { name: "Save" }).click();\n});`,
  },
  {
    id: "PW-SHOT-01",
    statement: "End every step with a screenshot attached to the report with testInfo.attach.",
    rationale: "Attachments are shown with the step in the report, so a reviewer sees what the application displayed at each step.",
    source: "https://playwright.dev/docs/api/class-testinfo#test-info-attach",
    example: `await testInfo.attach("address changed", { body: await page.screenshot(), contentType: "image/png" });`,
  },
  {
    id: "PW-ENV-01",
    statement:
      "Never use production data or a production URL: reach the application through the base URL of the configured environment, with relative paths, and never write a host in a test.",
    rationale: "With the base URL in the configuration, the same test runs against each test environment, and never against one it was not meant for.",
    source: "https://playwright.dev/docs/api/class-testoptions#test-options-base-url",
    example: `await page.goto("/policies");`,
  },
  {
    id: "PW-FACT-01",
    statement:
      "Never invent a value: every label, message, field and value a test enters or checks comes from the domain index or the knowledge sources; leave out what they do not give.",
    rationale: "A test checks the behaviour users see; a value guessed instead of read from the application tests nothing but the guess.",
    source: "https://playwright.dev/docs/best-practices#test-user-visible-behavior",
    example: `// The contract documents the message "Policy saved".\nawait expect(page.getByRole("status")).toHaveText("Policy saved");`,
  },
  {
    id: "PW-ORG-01",
    statement:
      "Name and place files after the repository layout: tests in the folder of their application, in files ending with .spec.ts, reusable blocks as exported functions in the blocks folder of the application, journeys across applications in the journeys folder.",
    rationale: "Playwright finds test files by name and folder, and a fixed layout lets a reader find a test, a block or a journey without searching.",
    source: "https://playwright.dev/docs/test-configuration",
    example: `// With the default layout, in apps/policy-management/renew-policy.spec.ts:\nimport { openPolicy } from "./blocs/open-policy.ts";`,
  },
]);
