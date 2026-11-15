import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PageObjectFile, screenFile } from "../src/designer/page-object-file.ts";

const SEARCH = { name: "searchTextbox", parameters: [], expression: 'getByRole("textbox", { name: "Search...", exact: true })' };
const SHOW = { name: "showButtonInRow", parameters: ["row"], expression: 'getByRole("row", { name: row }).getByRole("button", { name: "Show", exact: true })' };

describe("the page object of a screen", () => {
  it("is named after its route: a record is an item, and the first screen is home", () => {
    assert.deepEqual(
      [screenFile("/"), screenFile("/customers/:id/edit_profile"), screenFile("/#/login"), screenFile("/2fa")],
      [
        { name: "HomePage", file: "home.page.ts" },
        { name: "CustomersItemEditProfilePage", file: "customers-item-edit-profile.page.ts" },
        { name: "LoginPage", file: "login.page.ts" },
        { name: "Screen2faPage", file: "2fa.page.ts" },
      ],
    );
  });

  it("holds each locator once, as a getter or as a method given what it needs, and numbers a name another locator took", () => {
    const file = new PageObjectFile(screenFile("/customers"), "/customers of Shop");
    assert.deepEqual(
      [file.member(SEARCH), file.member(SHOW), file.member({ ...SEARCH, expression: 'getByRole("textbox", { name: "Search" })' }), file.member(SHOW)],
      ["searchTextbox", "showButtonInRow", "searchTextbox2", "showButtonInRow"],
    );
    assert.equal(
      file.content,
      `import type { Locator, Page } from "@playwright/test";

/** The screen /customers of Shop: where its elements are. What a test expects of them stays in the test. */
export class CustomersPage {
  constructor(readonly page: Page) {}

  get searchTextbox(): Locator {
    return this.page.getByRole("textbox", { name: "Search...", exact: true });
  }

  showButtonInRow(row: string): Locator {
    return this.page.getByRole("row", { name: row }).getByRole("button", { name: "Show", exact: true });
  }

  get searchTextbox2(): Locator {
    return this.page.getByRole("textbox", { name: "Search" });
  }
}
`,
    );
  });

  it("adds to a file already there, keeps what a person wrote in it and the name they gave a locator", () => {
    const own = `import type { Locator, Page } from "@playwright/test";

export class Customers {
  constructor(readonly page: Page) {}

  get search(): Locator {
    return this.page.getByRole("textbox", { name: "Search...", exact: true });
  }

  async showButtonInRow(): Promise<void> {}
}
`;
    const file = new PageObjectFile(screenFile("/customers"), "/customers of Shop", own);
    assert.deepEqual([file.member(SEARCH), file.member(SHOW)], ["search", "showButtonInRow2"]);
    assert.equal(
      file.content,
      own.replace(
        "  async showButtonInRow(): Promise<void> {}\n}\n",
        `  async showButtonInRow(): Promise<void> {}

  showButtonInRow2(row: string): Locator {
    return this.page.getByRole("row", { name: row }).getByRole("button", { name: "Show", exact: true });
  }
}
`,
      ),
    );
  });
});
