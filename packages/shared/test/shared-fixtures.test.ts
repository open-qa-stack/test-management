import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  applicationClass,
  applicationPages,
  applicationVariable,
  appsFrom,
  camelName,
  className,
  PAGES_FOLDER,
  PAGES_INDEX,
  screenMember,
  sharedFixtures,
  tabVariable,
} from "../src/index.ts";

describe("the names a test gives an application", () => {
  it("are its identifier in camel case for its fixture, in Pascal case for its class, and never start with a digit", () => {
    assert.deepEqual(
      ["customer-management", "shop", "3d-viewer", "CRM_core"].map((id) => [applicationVariable(id), applicationClass(id)]),
      [
        ["customerManagement", "CustomerManagement"],
        ["shop", "Shop"],
        ["app3dViewer", "App3dViewer"],
        ["crmCore", "CrmCore"],
      ],
    );
  });

  it("fall back on a word for a text without one", () => {
    assert.deepEqual([camelName("…", "element"), className("", "screen")], ["element", "Screen"]);
  });

  it("name the tab a test opens itself after the application", () => {
    assert.deepEqual([tabVariable("customer-management"), tabVariable("3d-viewer")], ["customerManagementPage", "app3dViewerPage"]);
  });
});

describe("the file that gathers the page objects of an application", () => {
  it("is index.ts in the folder pages", () => {
    assert.deepEqual([PAGES_FOLDER, PAGES_INDEX], ["pages", "index.ts"]);
  });

  it("holds one page object of each screen, in the order of their names, all on one page", () => {
    assert.equal(
      applicationPages({ id: "customer-management", name: "Customer Management" }, [
        { name: "HomePage", file: "home.page.ts" },
        { name: "CustomersItemPage", file: "customers-item.page.ts" },
      ]),
      `import type { Page } from "@playwright/test";
import { CustomersItemPage } from "./customers-item.page.ts";
import { HomePage } from "./home.page.ts";

/** The screens of Customer Management, on one page. Written by oqas from the page objects of this folder: add nothing here. */
export class CustomerManagement {
  readonly customersItem: CustomersItemPage;
  readonly home: HomePage;

  constructor(readonly page: Page) {
    this.customersItem = new CustomersItemPage(page);
    this.home = new HomePage(page);
  }
}
`,
    );
    assert.deepEqual([screenMember("CustomersItemPage"), screenMember("Checkout")], ["customersItem", "checkout"]);
  });

  it("holds the page alone before any screen has a page object", () => {
    assert.equal(
      applicationPages({ id: "shop", name: "Shop" }, []),
      `import type { Page } from "@playwright/test";

/** The screens of Shop, on one page. Written by oqas from the page objects of this folder: add nothing here. */
export class Shop {
  constructor(readonly page: Page) {}
}
`,
    );
  });
});

describe("the fixtures the tests of a repository share", () => {
  it("import the applications from their folder, wherever the file is", () => {
    assert.deepEqual([appsFrom("apps/fixtures.ts", "apps"), appsFrom("support/test.ts", "apps"), appsFrom("fixtures.ts", "apps")], [".", "../apps", "./apps"]);
    assert.match(sharedFixtures(["shop"], "../apps"), /^import \{ Shop \} from "\.\.\/apps\/shop\/pages\/index\.ts";$/m);
  });

  it("give the test and the expect of Playwright, with each application: on the page of its own tests, on a tab of its own in the others", () => {
    assert.equal(
      sharedFixtures(["shop", "customer-management"]),
      `import { test as base, expect } from "@playwright/test";
import { Shop } from "./shop/pages/index.ts";
import { CustomerManagement } from "./customer-management/pages/index.ts";

/** Each application, with the page objects of its screens. */
interface Applications {
  shop: Shop;
  customerManagement: CustomerManagement;
}

/**
 * The test every test file imports: that of Playwright, with the fixtures of this repository. The application
 * of a test is on its page; another one has a tab of its own in the same browser context.
 */
export const test = base.extend<Applications>({
  shop: async ({ page, context }, use, testInfo) => {
    await use(new Shop(testInfo.project.name === "shop" ? page : await context.newPage()));
  },
  customerManagement: async ({ page, context }, use, testInfo) => {
    await use(new CustomerManagement(testInfo.project.name === "customer-management" ? page : await context.newPage()));
  },
});

export { expect };
`,
    );
  });
});
