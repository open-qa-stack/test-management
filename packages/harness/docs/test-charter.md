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

The instructions of the designer end with a method, which the reviewer does not get. The charter says what a test must keep; the method says how to get to a test that verifies a behaviour:

1. open the screen with the browser tools and read the snapshot the opening returns;
2. do the scenario by hand with the tools, each of which returns the lines that appeared;
3. note what the action produced, which is what the test asserts, and take a snapshot when nothing appeared;
4. write the test with the locators the tools returned: the one given for an element acted on, the role and the name, or a part of it that no other element holds, for an element only read;
5. make each locator match one element, with `exact` or a parent, never by position;
6. run it;
7. when it fails, read the error, look at the screen again and fix the locator or the wait, without ever removing the assertion that verifies the scenario; when the application is at fault, run it once more and propose it as failing.

It then says what makes an assertion worth writing — it checks the result of the action, with data seen on the screen or read in the sources, not that a field or a button is visible — and gives one worked example: the test of the orders search of an invented shop. The example parses as TypeScript and passes the check below against the default charter; the order it searches is reference data of the test environment, which the test only reads. The method is the same whatever the rules in force: a rule disabled in the configuration still shows in the example.

```ts
const charter = resolveCharter(config.charter);
if (!charter.ok) throw new Error(charter.errors.map((e) => `${e.path}: ${e.message}`).join("\n"));
const instructions = designerInstructions(charter.rules, config.repository);
```

## Checking a proposed test

Before a proposed test is written to the test repository, `CharterCheck` type-checks it and lints it against the charter, without network and without running it. It returns the findings, by line and column, for the agent to correct its test:

- a `compiler` finding carries the code of the TypeScript error, such as `TS2322`, or `syntax` when the file does not parse;
- a `charter` finding carries the identifier of the rule it breaks, such as `PW-WAIT-01`.

No finding means the test may be written. The check filters; the review of the branch still decides.

```ts
const check: TestCheck = new CharterCheck({ repository: "/path/to/tests", rules: charter.rules });
const findings = await check.check({ path: "apps/policies/renew-policy.spec.ts", content });
if (findings.length > 0) {
  // give the findings back to the agent, such as "PW-WAIT-01 at 12:9: Unexpected use of page.waitForTimeout()."
}
```

`TestCheck`, `ProposedTest` and `TestFinding` are types of `@open-qa-stack/domain`, so a role depends on the check through the domain only.

The test is copied to a temporary folder that sees the files of the repository and its installed packages, so the test repository needs its dependencies installed, `@playwright/test` first; a relative import resolves against the repository as if the test were already in place. The compiler runs in strict mode, with the module resolution of a bundler and imports that end in `.ts`, whatever the TypeScript configuration of the repository. A path that is absolute, leaves the repository, enters `node_modules` or does not end in `.ts` is refused with a `RangeError`.

The linter is oxlint, with its type-aware mode and the rules of `eslint-plugin-playwright`. A rule disabled in the configuration turns its controls off; a rule added by the configuration is not checked. The table below, generated by `pnpm charter:doc`, says how each rule of the default charter is checked.

<!-- controls:start -->

| Rule | Lint rules | What is checked |
|---|---|---|
| PW-LOC-01 | `playwright/prefer-native-locators`, `playwright/no-get-by-title` | Flags a locator that a getBy method replaces, and getByTitle. Whether getByRole came first is left to review. |
| PW-LOC-02 | `playwright/no-raw-locators`, `playwright/no-element-handle`, `playwright/no-nth-methods` | Flags CSS and XPath locators, element handles, and first, last and nth. |
| PW-ASSERT-01 | `playwright/expect-expect`, `playwright/prefer-web-first-assertions`, `playwright/missing-playwright-await` | Flags a test without assertion, an assertion on a value read once from the page, and an assertion that is not awaited. |
| PW-WAIT-01 | `playwright/no-wait-for-timeout`, `playwright/no-wait-for-selector`, `no-restricted-globals` | Flags page.waitForTimeout, page.waitForSelector, setTimeout and setInterval. |
| PW-ISO-01 | `playwright/no-export` | Flags an export from a test file, which another test could import. Shared state, order and serial mode are left to review. |
| PW-DATA-01 | none | Not checked: how a test prepares and removes its data is left to review. |
| PW-STEP-01 | none | Not checked: which actions are business actions is left to review. |
| PW-SHOT-01 | none | Not checked: no lint rule ties a screenshot to the end of a step. |
| PW-ENV-01 | none | Not checked: no lint rule knows the addresses of the environments. |
| PW-FACT-01 | none | Not checked: whether a value comes from the sources or the screens is left to review. |
| PW-ORG-01 | none | Not checked: the path of a test is chosen before it is checked. |

<!-- controls:end -->

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

Never invent a value: every label, message, field and value a test enters or checks comes from the domain index, the knowledge sources or the screens of the application; leave out what they do not give.

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
