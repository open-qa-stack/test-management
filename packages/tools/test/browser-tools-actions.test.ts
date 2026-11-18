import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { chromium } from "playwright-core";
import { BrowserSession } from "../src/browser/browser-session.ts";
import { ACTION_TIMEOUT_MS, NAVIGATION_TIMEOUT_MS } from "../src/browser/browser-tools.ts";
import { browserTools } from "../src/index.ts";
import { ENV, site, screenshots, applications, withTools, page, reject } from "./browser-tools-support.ts";

describe("criterion 3 — actions use the recommended locators, and a failed action says why with the page", () => {
  it("fills and clicks by role, label and test id", async () => {
    await withTools(async (tool) => {
      const codes = [
        await tool("shop_fill").execute({ target: { label: "Email" }, value: "eve@example.com" }),
        await tool("shop_fill").execute({ target: { label: "Promo" }, value: 'SPRING "24"' }),
        await tool("shop_click").execute({ target: { role: "button", name: "Sign in" } }),
        await tool("shop_click").execute({ target: { testId: "delete-1" } }),
        await tool("shop_click").execute({ target: { text: "Card" } }),
      ].map((result) => (result as { code: string }).code);
      assert.deepEqual(codes, [
        'await page.getByLabel("Email", { exact: true }).fill("eve@example.com");',
        'await page.getByLabel("Promo", { exact: true }).fill("SPRING \\"24\\"");',
        'await page.getByRole("button", { name: "Sign in", exact: true }).click();',
        'await page.getByTestId("delete-1").click();',
        'await page.getByText("Card", { exact: true }).click();',
      ]);
      const text = await page(tool);
      assert.match(text, /paragraph \[ref=e\d+\]: Hello eve@example\.com$/m);
      assert.match(text, /textbox "Promo Code" \[ref=e\d+\]: SPRING "24" →/);
      assert.match(text, /: Card opened/);
    });
  });

  it("chooses an option, checks a box, and waits for an element, a hidden one or an address", async () => {
    await withTools(async (tool) => {
      const codes = [
        await tool("shop_select_option").execute({ target: { role: "combobox", name: "Kind" }, option: "Car" }),
        await tool("shop_check").execute({ target: { role: "checkbox" }, checked: false }),
        await tool("shop_check").execute({ target: { role: "checkbox" }, checked: true }),
      ].map((result) => (result as { code: string }).code);
      assert.deepEqual(codes, [
        'await page.getByRole("combobox", { name: "Kind", exact: true }).selectOption("Car");',
        'await page.getByRole("checkbox").uncheck();',
        'await page.getByRole("checkbox").check();',
      ]);
      await tool("shop_wait_for").execute({ target: { text: "Banner" } });
      await tool("shop_click").execute({ target: { role: "button", name: "Dismiss" } });
      await tool("shop_wait_for").execute({ target: { text: "Banner" }, state: "hidden" });
      const text = await page(tool);
      assert.match(text, /option "Car" \[selected\]/);
      assert.match(text, /checkbox \[checked\]/);
      await tool("shop_click").execute({ target: { role: "link", name: "Second" } });
      assert.deepEqual(await tool("shop_wait_for").execute({ urlIncludes: "/second" }), { url: `${site.origin}/second`, title: "/second" });
    });
  });

  it("says that an element is missing, or not unique, followed by the page as it is now", async () => {
    await withTools(async (tool) => {
      await reject(
        tool("shop_click").execute({ target: { role: "button", name: "Missing" } }),
        new RegExp(
          `^page\\.getByRole\\("button", \\{ name: "Missing", exact: true \\}\\) matches no element\\.\\n\\nThe page is now at ${site.origin}/:\\n- generic`,
        ),
      );
      await reject(
        tool("shop_click").execute({ target: { role: "button", name: "Locked" } }),
        new RegExp(
          String.raw`^page\.getByRole\("button", \{ name: "Locked", exact: true \}\) did not become ready within ${ACTION_TIMEOUT_MS} ms\.\n\nThe page is now at`,
        ),
      );
      await reject(
        tool("shop_click").execute({ target: { text: "Again" } }),
        // Two buttons that nothing tells apart: the page lacks what a test needs, not the agent.
        /^page\.getByText\("Again", \{ exact: true \}\) matches 2 elements, and no locator the test charter allows tells them apart: the page gives them no label of their own, no test id, and no row or dialog that holds one alone\. This is a defect of testability of the application, not of the test\. Leave out what needs one of them, and say why, naming them: the application should give each its own label or a test id\.\n\nThe page is now at/,
      );
      await reject(
        tool("shop_fill").execute({ target: { role: "button", name: "Sign in" }, value: "x" }),
        /Element is not an <input>.*\n\nThe page is now at/s,
      );
      await reject(
        tool("shop_wait_for").execute({ target: { text: "Never" }, timeoutMs: 100 }),
        /^page\.getByText\("Never", \{ exact: true \}\) matches no element\./,
      );
      await reject(
        tool("shop_wait_for").execute({ target: { text: "Banner" }, state: "hidden", timeoutMs: 100 }),
        /^page\.getByText\("Banner", \{ exact: true \}\) did not become hidden within 100 ms\./,
      );
      await reject(
        tool("shop_wait_for").execute({ urlIncludes: "/never", timeoutMs: 100 }),
        /^The address did not come to include "\/never" within 100 ms\.\n\nThe page is now at/,
      );
    });
  });

  it("refuses a wait that names both an element and an address, or neither", async () => {
    await withTools(async (tool) => {
      const { parameters } = tool("shop_wait_for");
      const { Ajv2020 } = await import("ajv/dist/2020.js");
      const valid = new Ajv2020({ strict: false }).compile(parameters);
      assert.equal(valid({ target: { text: "x" }, urlIncludes: "/a" }), false);
      assert.equal(valid({ urlIncludes: "/a", state: "hidden" }), false);
      assert.equal(valid({}), false);
      assert.equal(valid({ target: { text: "x" }, state: "hidden" }), true);
    });
  });

  it("reports what an action threw when it is not an error, and a page it cannot read", async () => {
    const session = new BrowserSession(() => chromium.launch(), { actionMs: ACTION_TIMEOUT_MS, navigationMs: NAVIGATION_TIMEOUT_MS, settleMs: 0 });
    try {
      const shop = await session.page({ applicationId: "shop", uiUrl: site.origin, origins: new Set([site.origin]) });
      await reject(
        shop.act({ text: "Card" }, () => Promise.reject("plain")),
        /^plain\n\nThe page is now at/,
      );
      await reject(
        shop.act({ text: "Card" }, async (card) => {
          await card.page().close();
          throw new Error("closed");
        }),
        /^closed\n\nThe page cannot be read now: /,
      );
      await reject(shop.waitFor({ urlIncludes: "/second" }, 100), /has been closed.*\n\nThe page cannot be read now: /);
    } finally {
      await session.close();
    }
  });
});

describe("criterion 4 — actions count against the task's action limit, snapshots and reads do not", () => {
  it("marks the tools that change the page as browser actions", () => {
    const { tools } = browserTools(applications().slice(0, 1), { environment: "local", env: ENV, screenshotsDir: screenshots });
    assert.deepEqual(
      tools.filter((t) => t.browserAction === true).map((t) => t.name),
      ["shop_goto", "shop_click", "shop_fill", "shop_select_option", "shop_check"],
    );
  });
});
