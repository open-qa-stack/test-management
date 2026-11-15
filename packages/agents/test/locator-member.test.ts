import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { chainCalls, memberAction } from "../src/designer/locator-member.ts";

describe("the calls of a chain", () => {
  it("are cut at the dots between them, whatever a text, an object or a call given to one holds", () => {
    assert.deepEqual(chainCalls(`getByRole("row", { name: "A. \\"B\\"" }).filter({ has: page.getByText('x.y') }).nth(1).click()`), [
      `getByRole("row", { name: "A. \\"B\\"" })`,
      "filter({ has: page.getByText('x.y') })",
      "nth(1)",
      "click()",
    ]);
  });
});

describe("the member of a page object a line of code acts on", () => {
  it("is named after the element, its name then what it is, and is a getter", () => {
    assert.deepEqual(memberAction('await page.getByRole("textbox", { name: "Search...", exact: true }).fill("Ado. (x)");'), {
      member: { name: "searchTextbox", parameters: [], expression: 'getByRole("textbox", { name: "Search...", exact: true })' },
      given: [],
      action: 'fill("Ado. (x)")',
    });
  });

  it("is named after what the element is when the line finds it by its label, its placeholder, its text or anything else", () => {
    const names = (code: string) => memberAction(code)?.member.name;
    assert.deepEqual(
      [
        names('await page.getByLabel("Email Address").fill(process.env.SHOP_USERNAME!);'),
        names('await page.getByPlaceholder("Search").click();'),
        names('await page.getByText("Forgot your password?").click();'),
        names('await page.getByAltText("Logo").click();'),
        names('await page.getByTestId("save-all").click();'),
        names('await page.getByRole("button").click();'),
        names('await page.getByRole("button", { name: "…" }).click();'),
        names('await page.getByRole("link", { name: "One two three four five six seven" }).click();'),
      ],
      ["emailAddressField", "searchField", "forgotYourPasswordText", "logoImage", "saveAllElement", "button", "button", "oneTwoThreeFourFiveLink"],
    );
  });

  it("is a method given the name of each element the line finds its own within: which one is a matter of the test", () => {
    assert.deepEqual(memberAction('await page.getByRole("row", { name: "Ado Kinnett" }).getByRole("button", { name: "Show", exact: true }).click();'), {
      member: {
        name: "showButtonInRow",
        parameters: ["row"],
        expression: 'getByRole("row", { name: row }).getByRole("button", { name: "Show", exact: true })',
      },
      given: ['"Ado Kinnett"'],
      action: "click()",
    });
    // Two elements of the same kind are told apart, and one no text names is given nothing.
    assert.deepEqual(
      memberAction('await page.getByRole("table").getByRole("row", { name: "A" }).getByRole("row", { name: "B" }).getByText("Open").click();')?.member,
      {
        name: "openTextInRowInRowInTable",
        parameters: ["row", "row2"],
        expression: 'getByRole("table").getByRole("row", { name: row }).getByRole("row", { name: row2 }).getByText("Open")',
      },
    );
  });

  it("is none for a line that opens an address, or that acts in a way this does not read: the line stays as it is", () => {
    for (const code of [
      'await page.goto("/customers");',
      'await page.keyboard.press("Enter");',
      'await page.locator("#save").click();',
      'await page.getByRole("row", { name: "A" }).first().click();',
      "const rows = 3;",
    ])
      assert.equal(memberAction(code), undefined, code);
  });
});
