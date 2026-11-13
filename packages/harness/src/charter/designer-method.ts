/**
 * The worked example of the method: a functional test of the orders search of an invented shop, which
 * passes the charter check against the default charter.
 */
export const DESIGNER_METHOD_EXAMPLE = `import { expect, test } from "@playwright/test";

test("finds an order by the name of its customer", async ({ page }, testInfo) => {
  const orders = page.getByRole("table", { name: "Orders" });

  await test.step("Open the orders", async () => {
    await page.goto("/orders");
    await expect(orders.getByRole("row", { name: "ORD-1057" })).toContainText("Lena Brook");
    await testInfo.attach("orders", { body: await page.screenshot(), contentType: "image/png" });
  });

  await test.step("Search the orders of a customer by name", async () => {
    await page.getByRole("searchbox", { name: "Search orders", exact: true }).fill("Veldane");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(orders.getByRole("row", { name: "ORD-1042" })).toContainText("Mira Veldane");
    await expect(orders.getByRole("row", { name: "ORD-1057" })).toBeHidden();
    await testInfo.attach("orders found", { body: await page.screenshot(), contentType: "image/png" });
  });
});`;

const STEPS = [
  "Open the screen with the goto tool of the application and read the snapshot it returns.",
  "Do the scenario by hand with the fill, select_option, check and click tools; each returns the lines that appeared.",
  "Note what the action produced: a row, a text, the value of a field. That is what the test asserts. When nothing appeared, take a snapshot to see what is left.",
  "Write the test with locators copied from what the tools returned, never from memory. For an element you act on, copy the locator its line ends with, after →, as given. For an element you only read, use getByRole with its role and its name, or a part of the name that only it holds, such as the number of an order; for a text without a name, use getByText with exact: true inside its parent.",
  "Make each locator match one element: when a text matches several, add exact: true or start from a parent, such as the table; never pick one by its position.",
  "Run the test.",
  "When it fails, read the error and the step that failed, look at the screen again with the browser tools, then fix the locator, or wait for the result with an assertion on it. Never remove or weaken the assertion that verifies the scenario: when the application does not do what the scenario expects, keep the assertion, run the test once more and propose it as failing, saying what the run showed.",
];

const WORTH = [
  "a search lists a row that was not shown before, holding the name searched, and no longer lists a row that does not match;",
  "a detail shows the fields of the item opened, with their values;",
  "a search that matches nothing shows the empty state.",
];

const EXAMPLE_INTRO = [
  "Example, for a shop whose orders screen has a search; the test goes in the folder of the application, in search-orders.spec.ts.",
  "The orders base, read with the source tools, holds the order ORD-1042 of Mira Veldane as reference data of the test environment; the test only reads it.",
  'Before the search, the snapshot listed the latest orders, among them ORD-1057 of Lena Brook, and not ORD-1042; after the search of "Veldane", the row of the order ORD-1042 of Mira Veldane appeared and ORD-1057 was gone.',
].join(" ");

/**
 * How the test designer builds a test: the steps from the screen to a test that passes, what makes an
 * assertion worth writing, and a worked example.
 *
 * @remarks
 * The charter says what a test must keep; the method says how to get to a test that verifies a behaviour.
 * The text is the same whatever the rules in force.
 */
export const DESIGNER_METHOD = [
  `Method, for each test:\n${STEPS.map((step, index) => `${index + 1}. ${step}`).join("\n")}`,
  `An assertion is worth writing when it checks the result of the action:\n${WORTH.map((line) => `- ${line}`).join("\n")}\nCheck data you saw on the screen or read in the sources. That a field, a button or a page is visible verifies nothing.`,
  `${EXAMPLE_INTRO}\n${DESIGNER_METHOD_EXAMPLE.replace(/^(?=.)/gm, "    ")}`,
].join("\n\n");
