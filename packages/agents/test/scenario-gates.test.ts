import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlannedScenario } from "@open-qa-stack/domain";
import { moduleSyntax } from "@open-qa-stack/tools";
import type { Refusal } from "../src/designer/refusal.ts";
import { scenarioErrors } from "../src/designer/scenario-gates.ts";

const SEARCH: PlannedScenario = {
  id: "search-order",
  title: "Search an order by customer name",
  intent: "Verifies that a search by last name finds the order of the customer.",
  kind: "functional",
  case: "nominal",
  application: "shop",
  domain: "orders",
  sources: [{ source: "shop" }],
  data: [{ value: "Veldane", from: "shop" }],
  steps: [
    { action: "Open the orders", expects: [] },
    { action: "Search the orders of Veldane", expects: [{ result: "The order of Mira Veldane is listed alone", shows: ["ORD-1042", "OK"], absent: ["ORD-1057"] }] },
  ],
};

const OPEN = `  await test.step("1. Open the orders", async () => {\n    await page.goto("/orders");\n  });`;
const FILLED = [
  `    await page.getByRole("searchbox", { name: "Search orders" }).fill("Veldane");`,
  `    await expect(page.getByRole("row", { name: "ORD-1042" })).toContainText("Mira Veldane");`,
  `    await expect(page.getByRole("row", { name: "ORD-1057" })).toBeHidden();`,
];
/** A test of the scenario, whose second step holds the lines given. */
const spec = (second: readonly string[], first = OPEN, extra = "") => `import { expect, test } from "@playwright/test";\n\ntest("search", async ({ page }) => {\n${first}\n  await test.step("2. Search the orders of Veldane", async () => {\n${second.join("\n")}\n  });\n});\n${extra}`;

/** What a refusal gives as accepted: a skeleton, and the elements a screen showed the texts in. */
const HELP = {
  skeleton: "The skeleton.",
  locatorOf: (text: string) => new Map([["ORD-1042", 'page.getByRole("row", { name: "ORD-1042 Mira Veldane" })']]).get(text),
};

async function refusals(text: string, help = HELP): Promise<Refusal[]> {
  const syntax = await moduleSyntax(text);
  assert.ok(syntax.ok, JSON.stringify(syntax));
  return scenarioErrors(syntax.outline, SEARCH, help);
}

async function errors(text: string): Promise<string[]> {
  return (await refusals(text)).map((refusal) => `${refusal.code}: ${refusal.message}`);
}

describe("the gates of a test against its scenario", () => {
  it("accept a test that holds one test, the steps of the plan and each of its texts asserted the right way", async () => {
    assert.deepEqual(await errors(spec(FILLED)), []);
    // Any matcher, quotes and case: the planned text is held by a string of the statement.
    assert.deepEqual(await errors(spec([`    await expect(page.getByText('ord-1042')).toBeVisible();`, `    await expect(page.getByRole("table")).not.toContainText(\`ORD-1057\`);`])), []);
  });

  it("refuse a file with another number of tests, and steps that are not those of the plan in its order", async () => {
    assert.deepEqual(await errors(spec(FILLED, OPEN, `test("other", async () => {});\n`)), ["TEST-ONE: the file must hold exactly one test, that of scenario search-order."]);
    const swapped = spec(FILLED, OPEN.replace("1. Open", "Open"));
    assert.deepEqual(await errors(swapped), ['TEST-STEPS: the test must hold one test.step per step of the plan, in order, titled "1. …" to "2. …". Found: "Open the orders", "2. Search the orders of Veldane". Start from the skeleton of the scenario.']);
    const flat = `import { test } from "@playwright/test";\n\ntest("search", async () => {});\n`;
    assert.deepEqual((await errors(flat)).map((error) => error.split(":")[0]), ["TEST-STEPS", "TEST-VALUE", "TEST-VALUE"]);
    assert.match((await errors(flat))[0]!, /Found: none\./);
    const computed = spec(FILLED, OPEN.replace('"1. Open the orders"', "title"));
    assert.match((await errors(computed))[0]!, /^TEST-STEPS: .* Found: "", "2\. Search the orders of Veldane"\./);
  });

  it("refuse a planned text asserted in no expect of its step, even in another step or outside an expect", async () => {
    const elsewhere = spec([FILLED[0]!, `    await page.getByText("ORD-1042").click();`, FILLED[2]!], `  await test.step("1. Open the orders", async () => {\n    await expect(page.getByText("ORD-1042")).toBeVisible();\n  });`);
    assert.deepEqual(await errors(elsewhere), [
      'TEST-VALUE: step 2 must assert "ORD-1042": expect 2.1 of the plan names it (The order of Mira Veldane is listed alone). No await expect of that step holds it. An expected text is never changed or dropped; when the application shows something else, keep the assertion and call propose_test with diagnosis.',
    ]);
    // A weaker text than the planned one does not hold it.
    assert.deepEqual((await errors(spec([FILLED[0]!, `    await expect(page.getByRole("row", { name: "ORD-10" })).toBeVisible();`, FILLED[2]!]))).map((error) => error.split(":")[0]), ["TEST-VALUE"]);
  });

  it("refuse a text asserted only the other way round", async () => {
    const reversed = spec([`    await expect(page.getByText("ORD-1042")).toBeHidden();`, `    await expect(page.getByText("ORD-1042")).not.toBeVisible();`, `    await expect(page.getByRole("row", { name: "ORD-1057" })).toBeVisible();`, `    await expect(page.getByRole("row", { name: "ORD-1057" })).not.toHaveCount(0);`]);
    assert.deepEqual(await errors(reversed), [
      'TEST-POLARITY: expect 2.1 says the screen shows "ORD-1042", and step 2 asserts the opposite. An expect is never reversed to pass. If the application does the opposite of the plan, call propose_test with diagnosis.',
      'TEST-POLARITY: expect 2.1 says the screen no longer shows "ORD-1057", and step 2 asserts the opposite. An expect is never reversed to pass. If the application does the opposite of the plan, call propose_test with diagnosis.',
    ]);
    // One assertion the right way is enough.
    assert.deepEqual(await errors(spec([...FILLED, `    await expect(page.getByText("ORD-1042")).toBeHidden({ timeout: 1 });`])), []);
  });

  it("refuse an assertion that expects a text its own locator found the element by", async () => {
    const tautology = spec([...FILLED, `    await expect(page.getByText("Mira Veldane")).toHaveText("Veldane");`, `    await expect(page.getByText("Mira")).toBeVisible();`]);
    assert.deepEqual(await errors(tautology), [
      'TEST-TAUT: line 11 looks for "Veldane" in an element found by that same text: it can only pass. Find the element by something else — its row, its label, its role — then expect the text.',
    ]);
  });

  it("give what they would accept: the skeleton for the form of the test, an assertion of each text in its step", async () => {
    const flat = `import { test } from "@playwright/test";\n\ntest("one", async () => {});\ntest("two", async () => {});\n`;
    assert.deepEqual((await refusals(flat)).map((refusal) => [refusal.code, refusal.remedy]), [
      ["TEST-ONE", "The skeleton."],
      ["TEST-STEPS", "The skeleton."],
      // The element the screen showed it in, by a locator that names it: it is visible.
      ["TEST-VALUE", 'In step 2: await expect(page.getByRole("row", { name: "ORD-1042 Mira Veldane" })).toBeVisible();'],
      // No screen gave its element: the text, anywhere on the page, is hidden.
      ["TEST-VALUE", 'In step 2: await expect(page.getByText("ORD-1057")).toBeHidden();'],
    ]);
    const reversed = spec([`    await expect(page.getByText("ORD-1042")).toBeHidden();`, ...FILLED.slice(2)]);
    // The element the screen showed it in, by a locator that does not name it: it holds the text.
    const inCell = { ...HELP, locatorOf: () => 'page.getByRole("cell").first()' };
    assert.deepEqual((await refusals(reversed, inCell)).map((refusal) => [refusal.code, refusal.remedy]), [["TEST-POLARITY", 'In step 2: await expect(page.getByRole("cell").first()).toContainText("ORD-1042");']]);
  });

  it("refuse a value typed that is none of the data of the scenario, nor a part of one long enough to be checked", async () => {
    const typed = spec([...FILLED, `    await page.getByRole("searchbox").fill("veld");`, `    await page.getByRole("searchbox").fill("");`, `    await page.getByRole("searchbox").fill("Brook");`, `    await page.getByRole("searchbox").fill("Ve");`, `    await page.getByLabel("Country").selectOption("Veldane");`]);
    assert.deepEqual(await errors(typed), [
      'TEST-TYPED: line 13 types "Brook", which is no value of the data of scenario search-order ("Veldane"). Type a value of the data.',
      'TEST-TYPED: line 14 types "Ve", which is no value of the data of scenario search-order ("Veldane"). Type a value of the data.',
    ]);
    const syntax = await moduleSyntax(typed);
    assert.ok(syntax.ok);
    assert.match(scenarioErrors(syntax.outline, { ...SEARCH, data: [] }, HELP)[0]!.message, /search-order \(none\)\. Type a value of the data\.$/);
  });
});
