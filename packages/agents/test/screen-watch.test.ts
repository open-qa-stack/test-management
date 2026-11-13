import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolDefinition } from "@open-qa-stack/domain";
import { ScreenWatch } from "../src/designer/screen-watch.ts";
import { namedTexts, usedLocators } from "../src/designer/test-locators.ts";

/** A page double: it shows the snapshots queued, the last one repeated, moving to the next when it is opened or acted on. */
function page(snapshots: string[]): { tools: ToolDefinition[]; calls: string[] } {
  const calls: string[] = [];
  let shown = snapshots.shift()!;
  const tool = (action: string, execute: () => unknown): ToolDefinition => ({
    name: `shop_${action}`,
    description: action,
    parameters: { type: "object" },
    execute: async () => {
      calls.push(action);
      return execute();
    },
  });
  const state = { url: "http://127.0.0.1/orders", title: "Orders" };
  const next = () => {
    shown = snapshots.shift() ?? shown;
    return state;
  };
  return {
    calls,
    tools: [
      tool("goto", next),
      tool("snapshot", () => ({ url: state.url, title: state.title, page: shown, truncated: false })),
      tool("click", next),
      tool("fill", next),
      tool("select_option", next),
      tool("check", next),
      tool("network", () => []),
    ],
  };
}

const LIST = ['- heading "Orders" [level=1] [ref=e2] → page.getByRole("heading", { name: "Orders", exact: true })', '- button "Search" [ref=e3] → page.getByRole("button", { name: "Search", exact: true })'].join("\n");
const FOUND = `${LIST.replace("[ref=e3]", "[ref=e9]")}\n  - paragraph [ref=e10]: Order 42 of Ada`;
const run = (watch: ScreenWatch, action: string) => watch.tools().find((tool) => tool.name === `shop_${action}`)!.execute({}) as Promise<Record<string, unknown>>;

describe("the screens the designer watches", () => {
  it("returns the page when it is opened, and what appeared after an action, the references of the elements aside", async () => {
    const { tools, calls } = page([LIST, LIST, FOUND]);
    const watch = new ScreenWatch(["shop", "ledger"], tools);
    assert.deepEqual(await run(watch, "goto"), { url: "http://127.0.0.1/orders", title: "Orders", page: LIST, truncated: false });
    assert.deepEqual(await run(watch, "click"), { url: "http://127.0.0.1/orders", title: "Orders", appeared: "- paragraph: Order 42 of Ada" });
    assert.deepEqual(calls, ["goto", "snapshot", "click", "snapshot"]);
    assert.deepEqual(watch.tools().map((tool) => tool.name), tools.map((tool) => tool.name));
    assert.equal(await run(watch, "network").then((result) => JSON.stringify(result)), "[]");
  });

  it("says when an action made nothing appear", async () => {
    const still = new ScreenWatch(["shop"], page([LIST]).tools);
    assert.equal((await run(still, "check"))["appeared"], "Nothing new appeared on the page.");
  });

  it("reads the page before an action when it was not read yet, and cuts a long list of what appeared", async () => {
    const rows = Array.from({ length: 70 }, (_, row) => `- row "Order ${row}"`).join("\n");
    const { tools, calls } = page([LIST, `${LIST}\n${rows}`]);
    const watch = new ScreenWatch(["shop"], tools);
    const result = await run(watch, "select_option");
    assert.deepEqual(calls, ["snapshot", "select_option", "snapshot"]);
    assert.equal(String(result["appeared"]).split("\n").length, 60);
    assert.equal(result["more"], "10 more lines appeared; take a snapshot to read them.");
  });

  it("asks the agent to look at the screens, then to do the steps of a scenario that acts", async () => {
    const watch = new ScreenWatch(["shop", "ledger"], page([LIST, FOUND]).tools);
    assert.match(watch.missing("shop", false)!, /^You have not looked at the screens of shop yet\. Open the page of the scenario with shop_goto/);
    await run(watch, "snapshot");
    assert.equal(watch.missing("shop", false), undefined);
    assert.match(watch.missing("shop", true)!, /^You have not done the steps of the scenario yourself yet\. Do them with shop_fill and shop_click/);
    await run(watch, "click");
    assert.equal(watch.missing("shop", true), undefined);
    // An application without a user interface is held to nothing.
    assert.deepEqual([watch.missing("ledger", true), watch.unseen("ledger", 'page.getByText("x")'), watch.shownBefore("ledger", 'expect(page.getByText("x"))')], [undefined, [], false]);
  });

  it("names the locators no screen showed, by role and by text, whatever the case", async () => {
    const watch = new ScreenWatch(["shop"], page([LIST]).tools);
    await run(watch, "goto");
    const test = `page.getByRole("heading", { name: 'orders' }); page.getByRole("button"); page.getByRole("link", { name: "Orders" }); page.getByText("Deliveries"); page.getByText("Deliveries"); page.getByLabel(\`Search\`); page.getByRole("row", { name: /Order/ });`;
    assert.deepEqual(watch.unseen("shop", test), ['getByRole("link", { name: "Orders" })', 'getByText("Deliveries")', 'getByRole("row", { name: /Order/ })']);
  });

  it("tells an assertion that names only what the page showed before the action", async () => {
    const watch = new ScreenWatch(["shop"], page([LIST, LIST, FOUND, LIST]).tools);
    await run(watch, "goto");
    await run(watch, "click");
    assert.equal(watch.shownBefore("shop", 'await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();'), true);
    assert.equal(watch.shownBefore("shop", 'await expect(page.getByRole("paragraph")).toContainText("Order 42");'), false);
    assert.equal(watch.shownBefore("shop", 'await expect(page.getByRole("heading", { name: "Orders" })).toHaveText("Order 42 of Ada");'), false);
    assert.equal(watch.shownBefore("shop", 'await expect(page.getByRole("row")).toHaveCount(1);'), false);
    assert.equal(watch.shownBefore("shop", 'await expect(page.getByText("Nowhere")).toBeVisible();'), false);
    // Opening the page again starts over what it showed before any action.
    await run(watch, "goto");
    assert.equal(watch.shownBefore("shop", 'await expect(page.getByRole("button", { name: "Search" })).toBeVisible();'), true);
  });
});

describe("the locators of a test", () => {
  it("are read in the order of the text, with the name or the text they look for when it is a string", () => {
    assert.deepEqual(usedLocators(`page.getByTestId('total'); page.getByRole("cell", { exact: true, name: "It\\'s 5 \\"CHF\\"" }); page.getByRole("list"); page.getByPlaceholder(name);`), [
      { code: "getByTestId('total')", text: "total" },
      { code: `getByRole("cell", { exact: true, name: "It\\'s 5 \\"CHF\\"" })`, role: "cell", text: `It's 5 "CHF"` },
      { code: 'getByRole("list")', role: "list" },
    ]);
  });

  it("give, with what an assertion expects, the texts it names", () => {
    assert.deepEqual(namedTexts(`await expect(page.getByRole("row", { name: "ORD-1" })).toContainText('Ada'); await expect(total).toHaveValue("12"); await expect(page.getByRole("status")).toHaveText(/done/);`), ["ORD-1", "Ada", "12"]);
  });
});
