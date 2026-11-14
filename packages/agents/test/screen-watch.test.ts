import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolDefinition } from "@open-qa-stack/domain";
import { moduleSyntax, type SpecOutline } from "@open-qa-stack/tools";
import { ScreenWatch, snapshotLines } from "../src/designer/screen-watch.ts";

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

  it("notes a value a field holds that the page shows beside the fields no longer, though a line that went showed it", async () => {
    const typed = (value: string) => `- textbox "Search" [ref=e4]: ${value} → page.getByRole("textbox", { name: "Search", exact: true })`;
    const rows = '- row "Ada Lovelace 3 orders" [ref=e5]:\n  - cell "Ada Lovelace" [ref=e6]';
    const none = '- columnheader "0 of 0" [ref=e7]';
    const searched = new ScreenWatch(["shop"], page([`${typed("Ada Lovelace")}\n${rows}`, `${typed("Ada Lovelace")}\n${none}`]).tools);
    assert.equal(
      (await run(searched, "click"))["note"],
      'Nothing beside the fields shows "Ada Lovelace" any more: if you searched it, it matched nothing. Try a part of it, such as a first or a last name.',
    );
    // A row that still shows the value, a value no line that went showed, and a value too short to be checked are no note.
    const found = new ScreenWatch(["shop"], page([`${typed("Ada")}\n${rows}\n- paragraph: Ada`, `${typed("Ada")}\n- paragraph: Ada`]).tools);
    const fresh = new ScreenWatch(["shop"], page([`${typed("Zed Quill")}\n${rows}`, `${typed("Zed Quill")}\n${none}`]).tools);
    const short = new ScreenWatch(["shop"], page([`${typed("Ad")}\n${rows}`, `${typed("Ad")}\n${none}`]).tools);
    for (const watch of [found, fresh, short]) assert.equal("note" in (await run(watch, "click")), false);
  });

  it("notes no value a search found before an action removed the row that showed it", async () => {
    const typed = (value: string) => `- textbox "Search" [ref=e4]: ${value} → page.getByRole("textbox", { name: "Search", exact: true })`;
    const link = (state: string) => `- link "Customers"${state} [ref=e2] → page.getByRole("link", { name: "Customers", exact: true })`;
    const row = '- row "Zed Quill 2 orders" [ref=e5]:\n  - cell "Zed Quill" [ref=e6]';
    const none = '- columnheader "0 of 0" [ref=e7]';
    // The search showed the row, then the deletion removed it.
    const deleted = new ScreenWatch(
      ["shop"],
      page([`${link("")}\n${typed("Zed")}`, `${link("")}\n${typed("Zed Quill")}\n${row}`, `${link("")}\n${typed("Zed Quill")}\n${none}`]).tools,
    );
    await run(deleted, "fill");
    assert.equal("note" in (await run(deleted, "click")), false);
    // A field filled while the list still showed the row, before the search emptied it, only moved the focus.
    const emptied = new ScreenWatch(
      ["shop"],
      page([`${link(" [active]")}\n${typed("")}\n${row}`, `${link("")}\n${typed("Zed Quill")}\n${row}`, `${link("")}\n${typed("Zed Quill")}\n${none}`]).tools,
    );
    await run(emptied, "fill");
    assert.match(String((await run(emptied, "click"))["note"]), /^Nothing beside the fields shows "Zed Quill" any more/);
  });

  it("keeps the lines of a page the runner showed as lines the screens showed, and none for an application without a user interface", () => {
    const lines = snapshotLines(
      '- list:\n  - listitem [ref=e4]: Lena Veldane\n  - link "lena@example.com" [cursor=pointer]:\n    - /url: mailto:lena@example.com\n',
    );
    assert.deepEqual(lines, ["- list:", "- listitem: Lena Veldane", '- link "lena@example.com":']);
    const watch = new ScreenWatch(["shop"], page([LIST]).tools);
    watch.recordPage("shop", lines);
    watch.recordPage("ledger", lines);
    assert.deepEqual([watch.shows("shop", "Lena Veldane"), watch.shows("ledger", "Lena Veldane"), watch.looks("shop")], [true, false, 0]);
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

  it("takes no line of a field as the result of an action, whether it appeared or went, empty or not", async () => {
    const field = (states: string) => `- textbox "Search orders"${states}: Mira → page.getByRole("textbox", { name: "Search orders", exact: true })`;
    const typed = `${LIST}\n${field(" [active]")}\n- textbox "Filter" [active] → page.getByRole("textbox", { name: "Filter", exact: true })\n- 'combobox "Kind":'\n- paragraph: Searching`;
    // The click only takes the focus from the field, whose line goes and comes back without its state.
    const clicked = `${LIST}\n${field("")}\n- textbox "Filter"\n- paragraph: Searching`;
    const watch = new ScreenWatch(["shop"], page([LIST, LIST, typed, clicked]).tools);
    await run(watch, "goto");
    await run(watch, "fill");
    await run(watch, "click");
    assert.deepEqual(
      [
        watch.changedByAction("shop", ["Search orders"], []),
        watch.changedByAction("shop", ["Mira"], []),
        watch.changedByAction("shop", ["Filter", "Kind"], []),
        watch.changedByAction("shop", [], ["Mira"]),
        watch.changedByAction("shop", ["Searching"], []),
      ],
      [false, false, false, false, true],
    );
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

  it("gives the element a screen showed a text in: the element it names, else one whose line holds it, else the field whose value it is, the last seen first", async () => {
    const before = `${LIST}\n- cell "Lena Brook"\n- row "ORD-1042 Orders" → page.getByRole("row", { name: "ORD-1042 Orders" })\n- button "Edit" → no unique locator: 2 elements match page.getByRole("button", { name: "Edit", exact: true })`;
    const after = `${LIST}\n- textbox "Search" [active]: Lena → page.getByRole("textbox", { name: "Search", exact: true })\n- 'cell "Price:  10"'`;
    const watch = new ScreenWatch(["shop", "ledger"], page([LIST, before, after]).tools);
    await run(watch, "goto");
    await run(watch, "fill");
    const shown = (locator: string, field = false) => ({ locator, field });
    assert.deepEqual(
      [
        watch.locatorOf("shop", "orders", false),
        watch.locatorOf("shop", "ORD-1042", false),
        watch.locatorOf("shop", "Lena", false),
        watch.locatorOf("shop", "price: 10", false),
      ],
      [
        shown('page.getByRole("heading", { name: "Orders", exact: true })'),
        shown('page.getByRole("row", { name: "ORD-1042 Orders" })'),
        shown('page.getByRole("textbox", { name: "Search", exact: true })', true),
        shown('page.getByRole("cell", { name: "Price:  10", exact: true })'),
      ],
    );
    // A text expected gone is found first in the lines an action removed.
    assert.deepEqual(
      [watch.locatorOf("shop", "Lena Brook", true), watch.locatorOf("shop", "Orders", true)],
      [shown('page.getByRole("cell", { name: "Lena Brook", exact: true })'), shown('page.getByRole("row", { name: "ORD-1042 Orders" })')],
    );
    // An element without a locator of its own, and an application without a user interface, give none.
    assert.deepEqual(
      [watch.locatorOf("shop", "Edit", false), watch.locatorOf("shop", "Nowhere", true), watch.locatorOf("ledger", "Orders", false)],
      [undefined, undefined, undefined],
    );
  });

  it("gives, for a text a field holds and a line of the result shows, that line, and no field for a text expected gone", async () => {
    const field = (value: string) => `- textbox "Search..." [active]: ${value} → page.getByRole("textbox", { name: "Search...", exact: true })`;
    const row = '- row "Ado Kinnett 1990" → page.getByRole("row", { name: "Ado Kinnett 1990" })';
    const watch = new ScreenWatch(
      ["shop"],
      page([LIST, LIST, `${LIST}\n${field("Ado Kinnett")}`, `${LIST}\n${field("Ado Kinnett")}\n${row}`, `${LIST}\n${field("zzqx")}`]).tools,
    );
    await run(watch, "goto");
    await run(watch, "fill");
    await run(watch, "click");
    await run(watch, "fill");
    const shown = (locator: string, field = false) => ({ locator, field });
    assert.deepEqual(
      [
        watch.locatorOf("shop", "Ado Kinnett", false),
        watch.locatorOf("shop", "Ado Kinnett", true),
        watch.locatorOf("shop", "zzqx", false),
        watch.locatorOf("shop", "zzq", false),
        watch.locatorOf("shop", "zzqx", true),
      ],
      [
        shown('page.getByRole("row", { name: "Ado Kinnett 1990" })'),
        shown('page.getByRole("row", { name: "Ado Kinnett 1990" })'),
        shown('page.getByRole("textbox", { name: "Search...", exact: true })', true),
        undefined,
        undefined,
      ],
    );
  });

  it("keeps the last five lines of code the tools that open or act on a page returned, the last first", async () => {
    let count = 0;
    const coded = (action: string): ToolDefinition => ({
      name: `shop_${action}`,
      description: action,
      parameters: { type: "object" },
      execute: async () => (action === "snapshot" ? { page: LIST, truncated: false } : { code: `line ${(count += 1)}` }),
    });
    const watch = new ScreenWatch(["shop", "ledger"], ["goto", "snapshot", "click", "fill", "select_option", "check"].map(coded));
    for (const action of ["goto", "click", "snapshot", "fill", "check", "click", "select_option"]) await run(watch, action);
    assert.deepEqual([watch.codes("shop"), watch.codes("ledger")], [["line 6", "line 5", "line 4", "line 3", "line 2"], []]);
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
