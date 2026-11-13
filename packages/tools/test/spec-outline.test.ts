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

  it("reads each expect statement, awaited or not, with the strings of its subject, without its message, and of its matcher, and whether it is negative or chains .or", async () => {
    const outline = await outlineOf(
      [
        `await expect(page.getByRole("row", { name: "ORD-1" })).toContainText('Ada');`,
        `await expect(total, "the total").toHaveValue("12");`,
        `await expect(page.getByText("Ada").or(page.getByText("None")), "a name").toBeVisible();`,
        `expect().toBeTruthy();`,
        `expect.soft(page.getByRole("status")).not.toHaveText(/done/);`,
        `await expect(page.getByText(\`Saved\`)).toBeHidden();`,
        `await expect(page.getByText("Gone")).not.toBeHidden();`,
        `await expect(rows).toHaveCount(0);`,
        `await expect(rows).not.toHaveCount(2);`,
        `await expect(page.getByText(\`\${name}\`)).toHaveText(\`\${name}!\`);`,
        `await page.getByRole("button", { name: "Save" }).click();`,
        `expected("x");`,
        `expect(total);`,
        `await done;`,
      ].join("\n"),
    );
    const read = (located: string[], subject: string[], expected: string[], matcher: string, negative: boolean, alternative = false) => ({
      located,
      subject,
      expected,
      matcher,
      negative,
      alternative,
    });
    assert.deepEqual(
      outline.assertions.map(({ located, subject, expected, matcher, negative, alternative }) => ({
        located,
        subject,
        expected,
        matcher,
        negative,
        alternative,
      })),
      [
        read(["ORD-1"], ["row", "ORD-1"], ["Ada"], "toContainText", false),
        read([], [], ["12"], "toHaveValue", false),
        read(["Ada", "None"], ["Ada", "None"], [], "toBeVisible", false, true),
        read([], [], [], "toBeTruthy", false),
        read([], ["status"], [], "toHaveText", true),
        read(["Saved"], ["Saved"], [], "toBeHidden", true),
        read(["Gone"], ["Gone"], [], "toBeHidden", false),
        read([], [], [], "toHaveCount", true),
        read([], [], [], "toHaveCount", true),
        read([], [], [], "toHaveText", false),
      ],
    );
    assert.deepEqual(outline.assertions.map(({ line, start, code }) => [line, start, code.length]).slice(0, 2), [
      [1, 0, 76],
      [2, 77, 51],
    ]);
  });

  it("counts the tests, and reads the steps no other step holds, with their title when it is a string", async () => {
    const text = [
      `test("a", async ({ page }) => {`,
      `  await test.step("1. Open", async () => {`,
      `    await test.step("inner", async () => {});`,
      `  });`,
      `  await test.step(title, async () => {});`,
      `});`,
      `test.describe("group", () => {});`,
      `test("b", async () => {});`,
    ].join("\n");
    const outline = await outlineOf(text);
    assert.equal(outline.tests, 2);
    assert.deepEqual(
      outline.steps.map((step) => [step.title, text.slice(step.start, step.end).split("(")[0]]),
      [
        ["1. Open", "test.step"],
        [undefined, "test.step"],
      ],
    );
    assert.ok(outline.steps[0]!.end < outline.steps[1]!.start);
  });

  it("reads the values the test types or chooses, when they are written as strings", async () => {
    const outline = await outlineOf(
      [
        `await search.fill("Veldane");`,
        `await search.fill(process.env.SHOP_PASSWORD!);`,
        `await page.getByLabel("Country").selectOption('Wales');`,
        `await search.pressSequentially(\`zz\`);`,
        `await search.type("");`,
        `await search.fill();`,
        `fill("free");`,
        `await search.click("x");`,
      ].join("\n"),
    );
    assert.deepEqual(outline.typed, [
      { line: 1, text: "Veldane" },
      { line: 3, text: "Wales" },
      { line: 4, text: "zz" },
      { line: 5, text: "" },
    ]);
  });
});
