import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { onTab } from "../src/designer/tab-variable.ts";

describe("the tab of another application in a test of several", () => {
  it("takes the place of page in a line of code, wherever the line acts on it, and nowhere else", () => {
    assert.equal(
      onTab('await expect(page.getByRole("row", { name: "Open the page." }).getByText("homepage.html")).toBeVisible();', "desk"),
      'await expect(deskPage.getByRole("row", { name: "Open the page." }).getByText("homepage.html")).toBeVisible();',
    );
    assert.equal(
      onTab('await this.page.reload(); await page.keyboard.press("Enter");', "desk"),
      'await this.page.reload(); await deskPage.keyboard.press("Enter");',
    );
  });
});
