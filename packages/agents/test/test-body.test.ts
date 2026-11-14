import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { testBody } from "../src/designer/test-body.ts";

describe("the body of a test", () => {
  it("is its text without its comments, the titles of its tests, steps and groups, and its layout", () => {
    const first = [
      'import { test, expect } from "@playwright/test";',
      "// Opens the orders.",
      'test.describe("Orders", () => {',
      '  test("Open the \\"orders\\"", async ({ page }) => {',
      "    await test.step('1. Open', async () => {",
      '      await page.goto("/orders"); /* the list */',
      '      await expect(page.getByText("Orders // all")).toBeVisible();',
      "    });",
      "  });",
      "});",
    ].join("\n");
    const second = first
      .replace("// Opens the orders.", "  // Something else.")
      .replace('"Orders", ()', "`Other`, ()")
      .replace('"Open the \\"orders\\""', "'List them'")
      .replace("'1. Open'", '"1. Go"')
      .replace("/* the list */", "")
      .replace(/\n/g, "\n\n");
    assert.equal(testBody(second), testBody(first));
    assert.equal(
      testBody(first),
      'import { test, expect } from "@playwright/test"; test.describe(, () => { test(, async ({ page }) => { await test.step(, async () => { await page.goto("/orders"); await expect(page.getByText("Orders // all")).toBeVisible(); }); }); });',
    );
    // What a test does and asserts is its body: another address, another text.
    assert.notEqual(testBody(first.replace("/orders", "/customers")), testBody(first));
    assert.notEqual(testBody(first.replace("Orders // all", "Customers")), testBody(first));
  });
});
