import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolDefinition } from "@open-qa-stack/domain";
import { moduleSyntax, type SpecOutline } from "@open-qa-stack/tools";
import { ScreenWatch } from "../src/designer/screen-watch.ts";

/** The outline of a text of a test. */
async function outlineOf(text: string): Promise<SpecOutline> {
  const syntax = await moduleSyntax(text);
  assert.ok(syntax.ok);
  return syntax.outline;
}
/** The locators of a text of a test. */
const locators = async (text: string) => (await outlineOf(text)).locators;

/**
 * A page double: it shows the snapshots queued, the last one repeated, moving to the next when it is opened
 * or acted on; a snapshot of a part of the page gives its first line.
 */
function page(snapshots: string[]): { tools: ToolDefinition[]; calls: string[] } {
  const calls: string[] = [];
  let shown = snapshots.shift()!;
  const tool = (action: string, execute: (args: { within?: unknown }) => unknown): ToolDefinition => ({
    name: `shop_${action}`,
    description: action,
    parameters: { type: "object" },
    execute: async (args) => {
      calls.push(action);
      return execute(args as { within?: unknown });
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
      tool("snapshot", ({ within }) => ({ url: state.url, title: state.title, page: within === undefined ? shown : shown.split("\n")[0]!, truncated: false })),
      tool("click", next),
      tool("fill", next),
      tool("select_option", next),
      tool("check", next),
      tool("network", () => []),
    ],
  };
}

const LIST = [
  '- heading "Orders" [level=1] [ref=e2] → page.getByRole("heading", { name: "Orders", exact: true })',
  '- button "Search" [ref=e3] [cursor=pointer] → page.getByRole("button", { name: "Search", exact: true })',
  "  - /url: /orders",
].join("\n");
const FOUND = `${LIST.replace("[ref=e3]", "[ref=e9]")}\n  - paragraph [ref=e10]: Order 42 of Ada\n- row [ref=e11]:\n  - cell "Ada Lovelace" [ref=e12]`;
/** The list as the agent is given it: without the references, the marks of what can be clicked, nor the addresses of the links. */
const SHOWN = [
  '- heading "Orders" [level=1] → page.getByRole("heading", { name: "Orders", exact: true })',
  '- button "Search" → page.getByRole("button", { name: "Search", exact: true })',
].join("\n");
const run = (watch: ScreenWatch, action: string) =>
  watch
    .tools()
    .find((tool) => tool.name === `shop_${action}`)!
    .execute({}) as Promise<Record<string, unknown>>;

describe("the screens the designer watches", () => {
  it("returns the page when it is opened, and what appeared after an action, the references of the elements aside", async () => {
    const { tools, calls } = page([LIST, LIST, FOUND]);
    // A tool of an application without a snapshot is given as it is.
    const unwatched: ToolDefinition = { name: "ledger_network", description: "network", parameters: { type: "object" }, execute: async () => [] };
    const watch = new ScreenWatch(["shop", "ledger"], [...tools, unwatched]);
    assert.equal(watch.tools().at(-1), unwatched);
    assert.deepEqual(await run(watch, "goto"), { url: "http://127.0.0.1/orders", title: "Orders", page: SHOWN, truncated: false });
    assert.deepEqual(await run(watch, "click"), {
      url: "http://127.0.0.1/orders",
      title: "Orders",
      appeared: '- paragraph: Order 42 of Ada\n- row:\n- cell "Ada Lovelace"',
      gone: "Nothing went from the page.",
    });
    assert.equal(((await run(watch, "snapshot")) as { page: string }).page.split("\n")[0], SHOWN.split("\n")[0]);
    assert.deepEqual(calls, ["goto", "snapshot", "click", "snapshot", "snapshot"]);
    assert.deepEqual(
      watch.tools().map((tool) => tool.name),
      [...tools, unwatched].map((tool) => tool.name),
    );
    assert.equal(await run(watch, "network").then((result) => JSON.stringify(result)), "[]");
    // Every browser tool of the application is a look at it, whether the watch adds to its result or not.
    assert.deepEqual([watch.looks("shop"), watch.looks("ledger")], [4, 0]);
  });

  it("says when an action made nothing appear, and what went", async () => {
    const still = new ScreenWatch(["shop"], page([LIST]).tools);
    assert.equal((await run(still, "check"))["appeared"], "Nothing new appeared on the page.");
    const filtered = new ScreenWatch(["shop"], page([FOUND, LIST]).tools);
    assert.equal((await run(filtered, "click"))["gone"], '- paragraph: Order 42 of Ada\n- row:\n- cell "Ada Lovelace"');
  });

  it("cuts a long list of what went", async () => {
    const rows = Array.from({ length: 25 }, (_, row) => `- row "Order ${row}"`).join("\n");
    const result = await run(new ScreenWatch(["shop"], page([`${LIST}\n${rows}`, LIST]).tools), "fill");
    assert.deepEqual(String(result["gone"]).split("\n").slice(19), ['- row "Order 19"', "5 more lines went."]);
  });

  it("compares an action with the last snapshot of the whole page, not with one of its parts", async () => {
    const { tools, calls } = page([LIST, LIST, FOUND]);
    const watch = new ScreenWatch(["shop"], tools);
    await run(watch, "goto");
    // A part of the page, such as a table, holds fewer lines than the page: what the action changed is told against the page.
    await watch
      .tools()
      .find((tool) => tool.name === "shop_snapshot")!
      .execute({ within: { role: "heading" } });
    const result = await run(watch, "click");
    assert.deepEqual([result["appeared"], result["gone"]], ['- paragraph: Order 42 of Ada\n- row:\n- cell "Ada Lovelace"', "Nothing went from the page."]);
    assert.deepEqual(calls, ["goto", "snapshot", "snapshot", "click", "snapshot"]);
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

  it("tells the applications it watches, and holds those without a user interface to nothing", async () => {
    const watch = new ScreenWatch(["shop", "ledger"], page([LIST]).tools);
    assert.deepEqual([watch.watches("shop"), watch.watches("ledger")], [true, false]);
    assert.deepEqual(watch.unseen("ledger", await locators('page.getByText("x")')), []);
  });

  it("names the locators no screen showed, by role and by text, whatever the case", async () => {
    const watch = new ScreenWatch(["shop"], page([LIST]).tools);
    await run(watch, "goto");
    const watch2 = new ScreenWatch(["shop"], page([LIST, FOUND]).tools);
    await run(watch2, "click");
    // The name of a row is that of its cells, on other lines; a role no screen showed is refused whatever its name.
    const test = `page.getByRole("heading", { name: 'orders' }); page.getByRole("button"); page.getByRole("row", { name: "Ada Lovelace" }); page.getByRole("link", { name: "Orders" }); page.getByText("Deliveries"); page.getByText("Deliveries"); page.getByLabel(\`Search\`); page.getByRole("dialog", { name: /Order/ });`;
    assert.deepEqual(
      watch2.unseen("shop", await locators(test)).map((locator) => locator.code),
      ['getByRole("link", { name: "Orders" })', 'getByText("Deliveries")', 'getByRole("dialog", { name: /Order/ })'],
    );
    assert.deepEqual(
      watch.unseen("shop", await locators('page.getByRole("row", { name: "Ada Lovelace" })')).map((locator) => locator.code),
      ['getByRole("row", { name: "Ada Lovelace" })'],
    );
  });

  it("gives the lines closest to locators no screen showed: same role or shared words, the most shared first, five at most", async () => {
    const rows = Array.from({ length: 7 }, (_, row) => `- row "Order ${row} of Ada" → page.getByRole("row", { name: "Order ${row} of Ada" })`).join("\n");
    const watch = new ScreenWatch(
      ["shop"],
      page([`${LIST}\n- link "Ada Brook" → page.getByRole("link", { name: "Ada Brook" })\n${rows}\n- paragraph: Ada`]).tools,
    );
    await run(watch, "goto");
    assert.deepEqual(watch.nearest("shop", await locators('page.getByRole("link", { name: "Brook Ada" })')), [
      '- link "Ada Brook" → page.getByRole("link", { name: "Ada Brook" })',
      ...[0, 1, 2, 3].map((row) => `- row "Order ${row} of Ada" → page.getByRole("row", { name: "Order ${row} of Ada" })`),
    ]);
    assert.deepEqual(watch.nearest("shop", await locators('page.getByText("Deliveries"); page.getByRole("paragraph");')), ["- paragraph: Ada"]);
  });

  it("tells whether an action made a text appear, or made one go, spaces and case aside", async () => {
    const watch = new ScreenWatch(["shop"], page([FOUND, FOUND, LIST, FOUND]).tools);
    await run(watch, "goto");
    assert.equal(watch.changedByAction("shop", ["Orders"], []), false);
    await run(watch, "click");
    // What was on the page before the action, and stays, was not made by it.
    assert.deepEqual(
      [watch.changedByAction("shop", ["Orders"], []), watch.changedByAction("shop", [], ["order  42 OF ada"]), watch.changedByAction("shop", ["Order 42"], [])],
      [false, true, false],
    );
    await run(watch, "click");
    assert.deepEqual(
      [watch.changedByAction("shop", ["Ada Lovelace"], []), watch.changedByAction("shop", ["Nowhere", "Order 42 of Ada"], ["Search"])],
      [true, true],
    );
    // A text too short to be checked is taken as made by an action.
    assert.equal(watch.changedByAction("shop", ["OK"], []), true);
  });

  it("tells a value the agent typed in a field from a text a screen showed before it was typed", async () => {
    const typed = `${LIST}\n- textbox "Search: orders" [active] [ref=e4]: Mira → page.getByRole("textbox", { name: "Search: orders", exact: true })\n- 'spinbutton "Count": 7 → page.getByRole("spinbutton")'\n- searchbox "Find": Quill`;
    const watch = new ScreenWatch(["shop", "ledger"], page([LIST, FOUND, typed]).tools);
    await run(watch, "goto");
    await run(watch, "fill");
    assert.deepEqual(
      ["Ada Lovelace", "Mira", "Quill", "Nowhere"].map((text) => [watch.showsBeforeTyped("shop", text), watch.typed("shop", text)]),
      [
        [true, false],
        [false, true],
        [false, true],
        [false, false],
      ],
    );
    // A field's name, and the locator a line ends with, are no value typed.
    assert.deepEqual([watch.typed("shop", "orders"), watch.typed("shop", "getByRole"), watch.typed("shop", "7")], [false, false, true]);
    assert.deepEqual([watch.showsBeforeTyped("ledger", "Mira"), watch.typed("ledger", "Mira")], [false, false]);
    // A value typed is dated by the snapshot that first showed it in its field, and is no text beside the fields.
    assert.deepEqual(
      [typeof watch.typedAt("shop", "mira"), watch.typedAt("shop", "Ada Lovelace"), watch.typedAt("ledger", "Mira")],
      ["number", undefined, undefined],
    );
    assert.deepEqual(
      [watch.showsBesideFields("shop", "Mira"), watch.showsBesideFields("shop", "Ada Lovelace"), watch.showsBesideFields("ledger", "Ada Lovelace")],
      [false, true, false],
    );
  });

  it("gives the locator of the element a screen showed a text in, the last seen first", async () => {
    const watch = new ScreenWatch(
      ["shop", "ledger"],
      page([LIST, LIST, `${LIST}\n- row "ORD-1042 Orders" → page.getByRole("row", { name: "ORD-1042 Orders" })`]).tools,
    );
    await run(watch, "goto");
    assert.equal(watch.locatorOf("shop", "orders"), 'page.getByRole("heading", { name: "Orders", exact: true })');
    await run(watch, "click");
    assert.deepEqual(
      [watch.locatorOf("shop", "orders"), watch.locatorOf("shop", "Ada"), watch.locatorOf("ledger", "Orders")],
      ['page.getByRole("row", { name: "ORD-1042 Orders" })', undefined, undefined],
    );
  });

  it("says in the description of each tool what it adds to its result", () => {
    const state = "Returns where the page is, and the line of code that does the same in a test.";
    const tools = page([LIST]).tools.map((tool) => ({ ...tool, description: `Acts on the page. ${state}` }));
    const described = new Map(new ScreenWatch(["shop"], tools).tools().map((tool) => [tool.name, tool.description]));
    assert.deepEqual(
      [described.get("shop_goto"), described.get("shop_click"), described.get("shop_snapshot")],
      [
        "Acts on the page. Returns what the page shows, and the line of code that does the same in a test.",
        "Acts on the page. Returns what appeared, what went, and the line of code that does the same in a test.",
        `Acts on the page. ${state}`,
      ],
    );
  });
});
