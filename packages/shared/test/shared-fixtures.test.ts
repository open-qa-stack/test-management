import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FIXTURES_FILE_NAME, sharedFixtures, tabVariable } from "../src/index.ts";

describe("the tab of an application in a test", () => {
  it("is named after the application, in camel case, and never as a number", () => {
    assert.deepEqual(
      [tabVariable("customer-management"), tabVariable("shop"), tabVariable("3d-viewer"), tabVariable("CRM_core")],
      ["customerManagementPage", "shopPage", "app3dViewerPage", "crmCorePage"],
    );
  });
});

describe("the fixtures the tests of a repository share", () => {
  it("are written in fixtures.ts", () => {
    assert.equal(FIXTURES_FILE_NAME, "fixtures.ts");
  });

  it("give the test and the expect of Playwright, with a tab for each application, opened in the context of the test", () => {
    assert.equal(
      sharedFixtures(["shop", "customer-management"]),
      `import { test as base, expect, type Page } from "@playwright/test";

/** A tab for each application: a page of its own in the browser context of the test, opened when the test asks for it. */
interface ApplicationTabs {
  shopPage: Page;
  customerManagementPage: Page;
}

/** The test every test file imports: that of Playwright, with the fixtures of this repository. */
export const test = base.extend<ApplicationTabs>({
  shopPage: async ({ context }, use) => {
    await use(await context.newPage());
  },
  customerManagementPage: async ({ context }, use) => {
    await use(await context.newPage());
  },
});

export { expect };
`,
    );
  });
});
