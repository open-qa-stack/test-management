import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { errorClass, failureHint } from "../src/designer/run-failure.ts";

const STRICT =
  "Error: expect(locator).toBeVisible() failed\n\nLocator: getByText('Ada')\nError: strict mode violation: getByText('Ada') resolved to 2 elements";
const TEXT = `Error: expect(locator).toContainText(expected) failed\n\nLocator: getByRole('row', { name: 'ORD-1042' })\nExpected substring: "Mira Veldane"\nReceived string: "${"ORD-1042 Lena Brook ".repeat(12)}"\nTimeout: 5000ms`;
const HIDDEN = "Error: expect(locator).toBeVisible() failed\n\nLocator: getByText('Order 42')\nTimeout: 5000ms\nError: element(s) not found";
/** A text matcher on an element that is not found: the error gives no received text. */
const MISSING = `Error: expect(locator).toContainText(expected) failed\n\nLocator: getByRole('row', { name: 'ORD-1042' })\nExpected substring: "Mira Veldane"\nTimeout: 5000ms\nError: element(s) not found`;
const ACTION = "TimeoutError: locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Search' })";
const NAVIGATION = "Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:1/orders";

describe("what a failed run stopped on", () => {
  it("is read from the error of the runner", () => {
    assert.deepEqual(
      [
        STRICT,
        TEXT,
        HIDDEN,
        MISSING,
        "Error: expect(page).not.toHaveURL(expected) failed",
        ACTION,
        NAVIGATION,
        "Error: Navigation timeout of 30000 ms exceeded",
        "Error: expect(received).toBe(expected)\n\nExpected: 200",
        "ReferenceError: total is not defined",
      ].map(errorClass),
      ["strict", "assertion", "assertion", "assertion", "assertion", "locator", "navigation", "navigation", "other", "other"],
    );
  });

  it("picks the one hint to follow", () => {
    assert.match(failureHint(STRICT, "shop"), /^The locator matches several elements\. .*Take shop_snapshot at that step to choose\.$/);
    assert.match(failureHint(ACTION, "shop"), /^The element is not on the screen at that step\./);
    assert.match(failureHint(NAVIGATION, "shop"), /^The page did not load\. Check the path with shop_goto;/);
    assert.match(failureHint("ReferenceError: total is not defined", "shop"), /^The run stopped on an error that is not an assertion;/);
    const text = failureHint(TEXT, "shop");
    assert.ok(
      text.startsWith(
        `The application shows "${"ORD-1042 Lena Brook ".repeat(12).slice(0, 199)}… where the plan expects "Mira Veldane". The expected text stays.`,
      ),
      text,
    );
    assert.match(
      failureHint(HIDDEN, "shop"),
      /^The application shows no such element where the plan expects something else\. .*call propose_test with diagnosis\.$/,
    );
    assert.match(failureHint(MISSING, "shop"), /^The application shows no such element where the plan expects "Mira Veldane"\. The expected text stays\./);
    assert.match(
      failureHint("Error: expect(locator).toBeHidden() failed\n\nExpected: hidden", "shop"),
      /^The application shows something else where the plan expects hidden\./,
    );
  });
});
