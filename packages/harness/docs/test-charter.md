# Test charter

The test designer writes Playwright tests and the reviewer checks them against the same charter: a list of numbered rules on how a test locates elements, waits, asserts, prepares its data, reports its steps and where it lives. The charter ships with `@open-qa-stack/harness` and changes with its version, so the tests an agent proposes do not depend on what the model happens to know about Playwright.

Each rule has a stable identifier, such as `PW-WAIT-01`, a statement, a rationale taken from the Playwright documentation and a conforming example. The reviewer cites the identifier of each rule a test breaks. An identifier is never given to another rule.

## Tuning the charter

The `charter` key of `oqas.json` (see the configuration file reference of `@open-qa-stack/shared`) disables default rules and adds rules of your own, each with a reason:

```json
{
  "charter": {
    "disable": [{ "rule": "PW-SHOT-01", "reason": "Screenshots are taken by the reporter." }],
    "add": [{ "id": "TEAM-TAG-01", "statement": "Tag every test with its domain, such as @policies.", "reason": "The nightly run selects tests by domain." }]
  }
}
```

Added rules come after the default ones, in the order of the file; their reason is given to the agents as the rationale. Disabling an identifier that names no default rule is a configuration error (`unknown-charter-rule`), and so is adding an identifier a default rule already has (`duplicate`); each error points at the offending key, such as `/charter/disable/0/rule`.

## Instructions

`resolveCharter(config.charter)` applies the changes and returns the rules to follow, or the errors. `designerInstructions(rules, config.repository)` and `reviewerInstructions(rules, config.repository)` write the system instructions of each agent: its role, every rule by its identifier with its rationale and example, then the folders of the repository layout. All three are pure: they read no file and call no model or network.

```ts
const charter = resolveCharter(config.charter);
if (!charter.ok) throw new Error(charter.errors.map((e) => `${e.path}: ${e.message}`).join("\n"));
const instructions = designerInstructions(charter.rules, config.repository);
```

## Rules

The list below is generated from the charter by `pnpm charter:doc`.

<!-- rules:start -->

### PW-LOC-01

Locate elements by role, label, text or test id: getByRole first, then getByLabel, getByText or getByTestId.

Why: These locators follow what the user perceives and survive changes to markup and styling. See the [Playwright documentation](https://playwright.dev/docs/locators).

```ts
await page.getByRole("button", { name: "Save" }).click();
```

### PW-LOC-02

Never locate an element by a CSS class, an XPath expression or its position in the page structure.

Why: Selectors tied to the structure of the page break whenever its markup changes, without any change for the user. See the [Playwright documentation](https://playwright.dev/docs/other-locators).

```ts
await page.getByTestId("policy-summary").getByRole("link", { name: "Details" }).click();
```

### PW-ASSERT-01

Assert with web-first assertions on a locator, await expect(locator), never on a value read once from the page.

Why: Web-first assertions retry until the condition holds or the timeout expires, so they wait for the application instead of racing it. See the [Playwright documentation](https://playwright.dev/docs/best-practices#use-web-first-assertions).

```ts
await expect(page.getByRole("status")).toHaveText("Policy saved");
```

### PW-WAIT-01

Never wait for a fixed time: no page.waitForTimeout, no timer.

Why: Tests that wait for a fixed time are inherently flaky; locators and assertions already wait for the page. See the [Playwright documentation](https://playwright.dev/docs/api/class-page#page-wait-for-timeout).

```ts
await expect(page.getByRole("table", { name: "Policies" })).toBeVisible();
```

### PW-ISO-01

Make every test independent: no state shared with another test, no reliance on the order of tests, no serial mode, and never call a test from another; share steps through exported functions or fixtures.

Why: Isolated tests can run alone, in any order and in parallel, and a failure points at one test instead of a chain. See the [Playwright documentation](https://playwright.dev/docs/best-practices#make-tests-as-isolated-as-possible).

```ts
test("renews a policy", async ({ page, policy }) => {
  await openPolicy(page, policy.id);
});
```

### PW-DATA-01

Prepare the data a test needs through the API or a fixture, never through the screens of another feature, and remove it once the test is over.

Why: Preparing data through the API is fast and reliable, and a fixture that cleans up after itself leaves nothing for the next test to trip on. See the [Playwright documentation](https://playwright.dev/docs/api-testing#establish-preconditions).

```ts
const test = base.extend<{ customer: Customer }>({
  customer: async ({ request }, use) => {
    const customer = await createCustomer(request);
    await use(customer);
    await deleteCustomer(request, customer.id);
  },
});
```

### PW-STEP-01

Wrap each business action of a test in test.step, titled in the words of the business.

Why: Steps structure the report and the trace, so a reader sees which action failed without reading the code. See the [Playwright documentation](https://playwright.dev/docs/api/class-test#test-step).

```ts
await test.step("Change the delivery address", async () => {
  await page.getByLabel("Street").fill(address.street);
  await page.getByRole("button", { name: "Save" }).click();
});
```

### PW-SHOT-01

End every step with a screenshot attached to the report with testInfo.attach.

Why: Attachments are shown with the step in the report, so a reviewer sees what the application displayed at each step. See the [Playwright documentation](https://playwright.dev/docs/api/class-testinfo#test-info-attach).

```ts
await testInfo.attach("address changed", { body: await page.screenshot(), contentType: "image/png" });
```

### PW-ENV-01

Never use production data or a production URL: reach the application through the base URL of the configured environment, with relative paths, and never write a host in a test.

Why: With the base URL in the configuration, the same test runs against each test environment, and never against one it was not meant for. See the [Playwright documentation](https://playwright.dev/docs/api/class-testoptions#test-options-base-url).

```ts
await page.goto("/policies");
```

### PW-FACT-01

Never invent a value: every label, message, field and value a test enters or checks comes from the domain index or the knowledge sources; leave out what they do not give.

Why: A test checks the behaviour users see; a value guessed instead of read from the application tests nothing but the guess. See the [Playwright documentation](https://playwright.dev/docs/best-practices#test-user-visible-behavior).

```ts
// The contract documents the message "Policy saved".
await expect(page.getByRole("status")).toHaveText("Policy saved");
```

### PW-ORG-01

Name and place files after the repository layout: tests in the folder of their application, in files ending with .spec.ts, reusable blocks as exported functions in the blocks folder of the application, journeys across applications in the journeys folder.

Why: Playwright finds test files by name and folder, and a fixed layout lets a reader find a test, a block or a journey without searching. See the [Playwright documentation](https://playwright.dev/docs/test-configuration).

```ts
// With the default layout, in apps/policy-management/renew-policy.spec.ts:
import { openPolicy } from "./blocs/open-policy.ts";
```

<!-- rules:end -->
