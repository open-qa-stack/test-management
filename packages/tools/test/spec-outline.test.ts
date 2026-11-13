import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { moduleSyntax, type SpecOutline } from "../src/index.ts";

async function outlineOf(text: string): Promise<SpecOutline> {
  const syntax = await moduleSyntax(text);
  assert.ok(syntax.ok, JSON.stringify(syntax));
  return syntax.outline;
}

describe("the outline of a test", () => {
  it("reads the locators in the order of the text, with the role and the name or the text they look for when it is a string", async () => {
    const outline = await outlineOf(
      `page.getByTestId('total'); page.getByRole("cell", { exact: true, name: "It\\'s 5 \\"CHF\\"" }); page.getByRole("list"); page.getByPlaceholder(name); rows.getByText(\`Ada\`); page.getByLabel(\`\${label}\`); page.getByRole("dialog", { name: /Order/ }); page.locator(".x"); getByRole("free"); page.getByRole("row", options); page.getByText();`,
    );
    assert.deepEqual(outline.locators, [
      { code: "getByTestId('total')", text: "total" },
      { code: `getByRole("cell", { exact: true, name: "It\\'s 5 \\"CHF\\"" })`, role: "cell", text: `It's 5 "CHF"` },
      { code: 'getByRole("list")', role: "list" },
      { code: "getByText(`Ada`)", text: "Ada" },
      { code: 'getByRole("dialog", { name: /Order/ })', role: "dialog" },
      { code: 'getByRole("row", options)', role: "row" },
    ]);
  });

  it("reads each expect statement, awaited or not, with the texts its locators look for and those its matcher expects", async () => {
    const outline = await outlineOf(
      [
        `await expect(page.getByRole("row", { name: "ORD-1" })).toContainText('Ada');`,
        `await expect(total).toHaveValue("12");`,
        `expect.soft(page.getByRole("status")).not.toHaveText(/done/);`,
        `await expect(page.getByText("Saved")).toBeVisible();`,
        `await page.getByRole("button", { name: "Save" }).click();`,
        `expected("x");`,
        `await done;`,
      ].join("\n"),
    );
    assert.deepEqual(
      outline.assertions,
      [
        { code: `await expect(page.getByRole("row", { name: "ORD-1" })).toContainText('Ada');`, texts: ["ORD-1", "Ada"] },
        { code: `await expect(total).toHaveValue("12");`, texts: ["12"] },
        { code: `expect.soft(page.getByRole("status")).not.toHaveText(/done/);`, texts: [] },
        { code: `await expect(page.getByText("Saved")).toBeVisible();`, texts: ["Saved"] },
      ],
    );
  });
});
