import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { PlannedScenario } from "@open-qa-stack/domain";
import { assertionAt, failurePageText, misplacedAtFailure, shownAtFailure } from "../src/designer/failure-page.ts";

const SCENARIO: PlannedScenario = {
  id: "view-profile",
  title: "View a profile",
  intent: "Verifies that a profile opens.",
  kind: "functional",
  level: "functional",
  effect: "read",
  case: "nominal",
  application: "shop",
  domain: "customers",
  feature: "listing",
  sources: [{ source: "shop" }],
  data: [],
  steps: [
    { action: "Open the customers", code: [], expects: [{ result: "The list shows", shows: ["Customers", "Ok"], absent: ["Gone"], elements: [] }] },
    { action: "Open the profile", code: [], expects: [] },
  ],
};
const PAGE = ['- heading "Customers"', '- textbox "Search": Customers'];

describe("the page at the failure of a run", () => {
  it("gives each text the step that failed expects shown, long enough to be checked, with the lines beside the fields that hold it", () => {
    assert.deepEqual(shownAtFailure(SCENARIO, "1. Open the customers › expect.toBeVisible", PAGE), [{ text: "Customers", lines: ['- heading "Customers"'] }]);
  });

  it("gives nothing when no step of the plan failed, or the step expects no text shown", () => {
    for (const step of [undefined, "Open the customers", "3. Close", "2. Open the profile"]) assert.deepEqual(shownAtFailure(SCENARIO, step, PAGE), [], step);
    assert.deepEqual(failurePageText([]), []);
  });

  it("gives the texts an assertion that found no element looked for, when the page showed each beside the fields", () => {
    const step = "1. Open the customers";
    const notFound = (locator: string) => `Error: expect(locator).toBeVisible() failed\n\nLocator: ${locator}\nError: element(s) not found`;
    const page = ['- heading "Customers"', "- text: Ok then"];
    assert.deepEqual(misplacedAtFailure(SCENARIO, step, page, notFound("getByRole('cell', { name: 'Customers' })")), [
      { text: "Customers", lines: ['- heading "Customers"'] },
    ]);
    // A matcher that found its element, or one of the page, says nothing of where the text is.
    assert.deepEqual(misplacedAtFailure(SCENARIO, step, page, "Error: expect(page).toHaveURL(expected) failed\n\nExpected pattern: /customers/"), []);
    // An assertion of none of the texts the step expects shown, such as one of a text it expects gone.
    assert.deepEqual(misplacedAtFailure(SCENARIO, step, page, notFound("getByText('Ledger')")), []);
    // A text it looked for that the page did not show beside the fields.
    assert.deepEqual(misplacedAtFailure(SCENARIO, step, PAGE, notFound("getByText('Customers')")), [{ text: "Customers", lines: ['- heading "Customers"'] }]);
    assert.deepEqual(misplacedAtFailure(SCENARIO, step, ['- textbox "Search": Customers'], notFound("getByText('Customers')")), []);
    // A text the step expects gone that the page still showed points to the application.
    assert.deepEqual(misplacedAtFailure(SCENARIO, step, [...page, "- text: Gone"], notFound("getByText('Customers')")), []);
  });

  it("asserts a text on the element that held it, or by the text alone", () => {
    assert.equal(assertionAt({ text: "Risk Factor", lines: ["- text: Risk Factor 45"] }), 'await expect(page.getByText("Risk Factor")).toBeVisible();');
    assert.equal(
      assertionAt({ text: "Lena", lines: ["- 'listitem: Lena: ok'"] }),
      'await expect(page.getByRole("listitem").filter({ hasText: "Lena" })).toBeVisible();',
    );
    assert.equal(assertionAt({ text: "Lena", lines: ["Lena"] }), 'await expect(page.getByText("Lena")).toBeVisible();');
  });
});
