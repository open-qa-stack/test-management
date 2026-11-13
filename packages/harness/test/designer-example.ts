/** A functional test of the orders search of an invented shop, which passes the charter check against the default charter. */
export const DESIGNER_EXAMPLE = `import { expect, test } from "@playwright/test";

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
