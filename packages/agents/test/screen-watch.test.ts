import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ToolDefinition } from "@open-qa-stack/domain";
import { moduleSyntax, type SpecOutline } from "@open-qa-stack/tools";
import {
  scenarioScope,
  screenScope,
  ScreenWatch,
  snapshotLines,
  type CheckedTarget,
  type NamedTarget,
  type TargetMatcher,
} from "../src/designer/screen-watch.ts";

/** The targets a page of these tests is asked about, which all have a name. */
const named = (targets: readonly CheckedTarget[]) => targets as readonly NamedTarget[];

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
const FOUND = `${LIST.replace("[ref=e3]", "[ref=e9]")}\n  - paragraph [ref=e10]: Order 42 of Ada\n- row [ref=e11]:\n  - cell "Ada Brennick" [ref=e12]`;
/** The list as the agent is given it: without the references, the marks of what can be clicked, nor the addresses of the links. */
const SHOWN = [
  '- heading "Orders" [level=1] → page.getByRole("heading", { name: "Orders", exact: true })',
  '- button "Search" → page.getByRole("button", { name: "Search", exact: true })',
].join("\n");
const run = (watch: ScreenWatch, action: string, args: object = {}) =>
  watch
    .tools()
    .find((tool) => tool.name === `shop_${action}`)!
    .execute(args) as Promise<Record<string, unknown>>;

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
      appeared: '- paragraph: Order 42 of Ada\n- row:\n- cell "Ada Brennick"',
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
    assert.equal((await run(filtered, "click"))["gone"], '- paragraph: Order 42 of Ada\n- row:\n- cell "Ada Brennick"');
  });

  it("notes a value a field holds that the page shows beside the fields no longer, though a line that went showed it", async () => {
    const typed = (value: string) => `- textbox "Search" [ref=e4]: ${value} → page.getByRole("textbox", { name: "Search", exact: true })`;
    const rows = '- row "Ada Brennick 3 orders" [ref=e5]:\n  - cell "Ada Brennick" [ref=e6]';
    const none = '- columnheader "0 of 0" [ref=e7]';
    const searched = new ScreenWatch(["shop"], page([`${typed("Ada Brennick")}\n${rows}`, `${typed("Ada Brennick")}\n${none}`]).tools);
    assert.equal(
      (await run(searched, "click"))["note"],
      'Nothing beside the fields shows "Ada Brennick" now, though a screen showed it: if you searched it, it matched nothing. Try a part of it, such as a first or a last name.',
    );
    // A search may tell the case: the value is the one the field held, exactly.
    assert.deepEqual(
      ["Ada Brennick", "ada brennick", "Ada"].map((value) => searched.unmatched("shop", value)),
      [true, false, false],
    );
    assert.equal(searched.unmatched("ledger", "Ada Brennick"), false);
    // A row that still shows the value, a value no line that went showed, and a value too short to be checked are no note.
    const found = new ScreenWatch(["shop"], page([`${typed("Ada")}\n${rows}\n- paragraph: Ada`, `${typed("Ada")}\n- paragraph: Ada`]).tools);
    const fresh = new ScreenWatch(["shop"], page([`${typed("Zed Quill")}\n${rows}`, `${typed("Zed Quill")}\n${none}`]).tools);
    const short = new ScreenWatch(["shop"], page([`${typed("Ad")}\n${rows}`, `${typed("Ad")}\n${none}`]).tools);
    for (const watch of [found, fresh, short]) assert.equal("note" in (await run(watch, "click")), false);
  });

  it("notes a value another screen showed beside the fields, once a search changed the page without it", async () => {
    const typed = (value: string) => `- textbox "Search" [ref=e4]: ${value} → page.getByRole("textbox", { name: "Search", exact: true })`;
    const home = '- heading "Home" [ref=e1]\n- cell "Ada Brennick" [ref=e2]';
    const rows = '- row "Bel Ross 2 orders" [ref=e5]:\n  - cell "Bel Ross" [ref=e6]';
    const none = '- columnheader "0 of 0" [ref=e7]';
    const { tools } = page([
      home,
      home,
      `${typed("")}\n${rows}`,
      `${typed("Ada Brennick")}\n${rows}`,
      `${typed("Ada Brennick")}\n${none}`,
      `${typed("Ada Brennick")}\n- cell "Ada Brennick"`,
    ]);
    const watch = new ScreenWatch(["shop"], tools);
    await run(watch, "goto");
    await run(watch, "click");
    // Typing changes only the field: nothing was searched yet.
    assert.equal("note" in (await run(watch, "fill", { value: "Ada Brennick" })), false);
    assert.match(String((await run(watch, "click"))["note"]), /^Nothing beside the fields shows "Ada Brennick" now, though a screen showed it/);
    assert.equal(watch.unmatched("shop", "Ada Brennick"), true);
    // Once a search found it, it is no longer searched in vain.
    assert.equal("note" in (await run(watch, "click")), false);
    assert.equal(watch.unmatched("shop", "Ada Brennick"), false);
  });

  it("notes no value another screen showed after an action that removed no line, nor one the agent did not type", async () => {
    const field = (value: string) => `- textbox "City" [ref=e4]: ${value} → page.getByRole("textbox", { name: "City", exact: true })`;
    const home = '- heading "Customers" [ref=e1]\n- cell "Springfield" [ref=e2]';
    // A form the agent filled, whose save only tells what is missing.
    const saved = page([
      home,
      home,
      `${field("")}\n- button "Save" [ref=e5]`,
      `${field("Springfield")}\n- button "Save" [ref=e5]`,
      `${field("Springfield")}\n- button "Save" [ref=e5]\n- paragraph: Phone is required`,
    ]);
    const form = new ScreenWatch(["shop"], saved.tools);
    await run(form, "goto");
    await run(form, "click");
    await run(form, "fill", { value: "Springfield" });
    assert.equal("note" in (await run(form, "click")), false);
    // A form the application filled, whose tabs change what it shows.
    const tabs = page([
      home,
      home,
      '- heading "Profile" [ref=e8]',
      `${field("Springfield")}\n- tab "General" [ref=e6]`,
      `${field("Springfield")}\n- tab "Contact" [ref=e7]`,
    ]);
    const filled = new ScreenWatch(["shop"], tabs.tools);
    await run(filled, "goto");
    await run(filled, "click");
    await run(filled, "click");
    assert.equal("note" in (await run(filled, "click")), false);
    assert.equal(filled.unmatched("shop", "Springfield"), false);
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
    assert.match(String((await run(emptied, "click"))["note"]), /^Nothing beside the fields shows "Zed Quill" now/);
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
    assert.deepEqual([result["appeared"], result["gone"]], ['- paragraph: Order 42 of Ada\n- row:\n- cell "Ada Brennick"', "Nothing went from the page."]);
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
    const test = `page.getByRole("heading", { name: 'orders' }); page.getByRole("button"); page.getByRole("row", { name: "Ada Brennick" }); page.getByRole("link", { name: "Orders" }); page.getByText("Deliveries"); page.getByText("Deliveries"); page.getByLabel(\`Search\`); page.getByRole("dialog", { name: /Order/ });`;
    assert.deepEqual(
      watch2.unseen("shop", await locators(test)).map((locator) => locator.code),
      ['getByRole("link", { name: "Orders" })', 'getByText("Deliveries")', 'getByRole("dialog", { name: /Order/ })'],
    );
    assert.deepEqual(
      watch.unseen("shop", await locators('page.getByRole("row", { name: "Ada Brennick" })')).map((locator) => locator.code),
      ['getByRole("row", { name: "Ada Brennick" })'],
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
      [watch.changedByAction("shop", ["Ada Brennick"], []), watch.changedByAction("shop", ["Nowhere", "Order 42 of Ada"], ["Search"])],
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
      ["Ada Brennick", "Mira", "Quill", "Nowhere"].map((text) => [watch.showsBeforeTyped("shop", text), watch.typed("shop", text)]),
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
      [typeof watch.typedAt("shop", "mira"), watch.typedAt("shop", "Ada Brennick"), watch.typedAt("ledger", "Mira")],
      ["number", undefined, undefined],
    );
    assert.deepEqual(
      [watch.showsBesideFields("shop", "Mira"), watch.showsBesideFields("shop", "Ada Brennick"), watch.showsBesideFields("ledger", "Ada Brennick")],
      [false, true, false],
    );
  });

  it("gives the element a screen showed a text in: the element it names, else one whose line holds it, else the field whose value it is, the last seen first", async () => {
    const before = `${LIST}\n- cell "Lena Brook"\n- row "ORD-1042 Orders" → page.getByRole("row", { name: "ORD-1042 Orders" })\n- button "Edit" → no unique locator: 2 elements match page.getByRole("button", { name: "Edit", exact: true })`;
    const after = `${LIST}\n- textbox "Search" [active]: Lena → page.getByRole("textbox", { name: "Search", exact: true })\n- 'cell "Price:  10"'`;
    const watch = new ScreenWatch(["shop", "ledger"], page([LIST, before, after]).tools);
    await run(watch, "goto");
    await run(watch, "fill");
    const shown = (locator: string, field = false) => ({ locator, field, count: 1 });
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
    // An element several share the locator of is given with their number; a text no line holds, and an application without a user interface, give none.
    assert.deepEqual(
      [watch.locatorOf("shop", "Edit", false), watch.locatorOf("shop", "Nowhere", true), watch.locatorOf("ledger", "Orders", false)],
      [{ locator: 'page.getByRole("button", { name: "Edit", exact: true })', field: false, count: 2 }, undefined, undefined],
    );
  });

  it("gives, for the step some actions do, only an element of the screen the step ends on", async () => {
    const list = '- link " Customers" → page.getByRole("link", { name: " Customers", exact: true })\n- cell "Mira Veldane"\n- cell "Lena Brook"';
    const filtered = `${list.replace('\n- cell "Lena Brook"', "")}\n- textbox "Search": Mira → page.getByRole("textbox", { name: "Search", exact: true })`;
    const profile = '- link "Customers" → page.getByRole("link", { name: "Customers", exact: true })\n- heading "Mira Veldane"';
    // Each action shows the next page and returns its line of code, so that it is numbered.
    const pages = [list, filtered, profile];
    let at = -1;
    const tool = (action: string, execute: () => unknown): ToolDefinition => ({
      name: `shop_${action}`,
      description: action,
      parameters: { type: "object" },
      execute: async () => execute(),
    });
    const acting = (action: string) =>
      tool(action, () => {
        at += 1;
        return { code: `${action};` };
      });
    const tools = [tool("snapshot", () => ({ page: pages[at]!, truncated: false })), ...["goto", "fill", "click", "select_option", "check"].map(acting)];
    const watch = new ScreenWatch(["shop"], tools);
    const numberOf = async (action: string) => (await run(watch, action))["action"] as number;
    const opened = await numberOf("goto");
    const searched = await numberOf("fill");
    const clicked = await numberOf("click");
    const shown = (locator: string, field = false) => ({ locator, field, count: 1 });
    const CELL = 'page.getByRole("cell", { name: "Mira Veldane", exact: true })';
    // The same text is in a cell of the list and in the heading of the profile: each step is given the element of its own screen.
    assert.deepEqual(
      [watch.locatorOf("shop", "Mira Veldane", false, [opened]), watch.locatorOf("shop", "Mira Veldane", false, [searched, clicked])],
      [shown(CELL), shown('page.getByRole("heading", { name: "Mira Veldane", exact: true })')], // the heading of the profile
    );
    // A link of the profile is no element of the list, though both hold the text; a text only another screen showed has no element.
    assert.deepEqual(watch.locatorOf("shop", "Customers", false, [opened]), shown('page.getByRole("link", { name: " Customers", exact: true })'));
    assert.equal(watch.locatorOf("shop", "Lena Brook", false, [clicked]), undefined);
    // The field holds the value while its screen is the one of the step, and no longer once the step ends elsewhere.
    assert.deepEqual(watch.locatorOf("shop", "Mira", false, [searched]), shown('page.getByRole("textbox", { name: "Search", exact: true })', true));
    assert.equal(watch.locatorOf("shop", "Mira", false, [clicked]), undefined);
    // A text expected gone is looked for in what the actions of the step removed, then in every screen; an unknown action counts for none.
    assert.deepEqual(watch.locatorOf("shop", "Lena Brook", true, [searched]), shown('page.getByRole("cell", { name: "Lena Brook", exact: true })'));
    const HEADING = 'page.getByRole("heading", { name: "Mira Veldane", exact: true })';
    assert.deepEqual(watch.locatorOf("shop", "Mira Veldane", true, [opened]), shown(HEADING));
    assert.deepEqual(watch.locatorOf("shop", "Mira Veldane", false, [99]), shown(HEADING));
  });

  it("checks on the page, while it shows them, the locators it builds by role and name, once per line that came, and looks for one element alone in the parts that hold it", async () => {
    const asked: string[][] = [];
    /** A page whose cells "Active" are three, one alone in the row of Mira Veldane, whose cell "Hidden" is not shown, and that has no cell "Ghost". */
    const matches: TargetMatcher = async (_application, targets) => {
      const codes = named(targets).map(({ role, name, within }) => `${within === undefined ? "" : `${within.role} ${within.name} > `}${role} ${name}`);
      asked.push(codes);
      return codes.map((code) => {
        const count = code === "cell Ghost" ? 0 : code === "cell Active" || code === "table Customers > cell Active" || code.endsWith("cell Paid") ? 3 : 1;
        return { code: `<${code}>`, count, visible: count === 1 && code !== "cell Hidden" };
      });
    };
    const table = [
      '- table "Customers":',
      '  - row "Mira Veldane Active":',
      '    - cell "Mira Veldane"',
      '    - cell "Active"',
      "    - generic:",
      '      - cell "Paid"',
      '  - row "Ada Brennick Active":',
      '    - cell "Active"',
      '- cell "Hidden"',
      '- cell "Ghost"',
      '- button "Save" → page.getByRole("button", { name: "Save", exact: true })',
    ].join("\n");
    const watch = new ScreenWatch(["shop"], page([LIST, table, `${table}\n- cell "New"`]).tools, matches);
    await run(watch, "goto");
    // Each named element without a locator of its own, once; then, for those several share, the parts that hold the first, the closest first.
    assert.deepEqual(asked, [
      ["table Customers", "row Mira Veldane Active", "cell Mira Veldane", "cell Active", "cell Paid", "row Ada Brennick Active", "cell Hidden", "cell Ghost"],
      ["row Mira Veldane Active > cell Active", "table Customers > cell Active"],
      ["row Mira Veldane Active > cell Paid", "table Customers > cell Paid"],
    ]);
    assert.deepEqual(
      ["Mira Veldane", "Active", "Paid", "Hidden", "Ghost", "Save"].map((text) => watch.locatorOf("shop", text, false)),
      [
        { locator: "<cell Mira Veldane>", field: false, count: 1 },
        { locator: "<cell Active>", field: false, count: 3, narrower: "<row Mira Veldane Active > cell Active>" },
        // No part that holds it tells one of them from the others.
        { locator: "<cell Paid>", field: false, count: 3 },
        // One element the page does not show, and none at all, are no element a test finds.
        { locator: "<cell Hidden>", field: false, count: 0 },
        { locator: "<cell Ghost>", field: false, count: 0 },
        { locator: 'page.getByRole("button", { name: "Save", exact: true })', field: false, count: 1 },
      ],
    );
    // Only a line the page did not show before is checked again.
    await run(watch, "click");
    assert.deepEqual(asked.slice(3), [["cell New"]]);
  });

  it("gives no element whose locator it could not check: past the most a snapshot is checked for, and on a page that cannot be looked at", async () => {
    const cells = Array.from({ length: 201 }, (_, at) => `- cell "Cell ${at + 1}"`).join("\n");
    const many = new ScreenWatch(["shop"], page([LIST, cells]).tools);
    await run(many, "goto");
    assert.deepEqual([many.locatorOf("shop", "Cell 200", false)?.count, many.locatorOf("shop", "Cell 201", false)], [1, undefined]);
    const unread = new ScreenWatch(
      ["shop"],
      page([LIST, '- cell "Active"\n- cell "Paid"', '- cell "Active"\n- cell "Paid"\n- cell "Late"']).tools,
      async (_application, targets) => {
        if (named(targets).some((target) => target.name === "Late" || target.within !== undefined)) throw new Error("The page navigates.");
        return named(targets).map((target) => ({ code: target.name, count: 2, visible: false }));
      },
    );
    await run(unread, "goto");
    await run(unread, "click");
    // The parts could not be looked at: the element is given without one alone; the line that came with a page that could not be read is not given.
    assert.deepEqual(
      [unread.locatorOf("shop", "Active", false), unread.locatorOf("shop", "Late", false)],
      [{ locator: "Active", field: false, count: 2 }, undefined],
    );
  });

  it("counts a text an element without a name shows, and finds the part of the page that holds one alone when several show it", async () => {
    const asked: CheckedTarget[] = [];
    /** A page that shows "Customer Profile" once, and "Open" in three places, one alone in its table. */
    const matches: TargetMatcher = async (_application, targets) =>
      targets.map((target) => {
        asked.push(target);
        const text = "text" in target ? target.text : target.name;
        const within = target.within === undefined ? "page" : `page.getByRole("${target.within.role}")`;
        const count = text === "Open" && target.within?.role !== "table" ? 3 : 1;
        return { code: `${within}.getByText(${JSON.stringify(text)}, { exact: true })`, count, visible: count === 1 };
      });
    const shown = [
      "- main:",
      "  - paragraph: Customer Profile",
      '  - paragraph: "Phone: 055 222 41 11"',
      "  - table:",
      "    - generic: Open",
      "  - generic: ok",
      '  - textbox "Search": Open',
    ].join("\n");
    const watch = new ScreenWatch(["shop"], page([shown]).tools, matches);
    await run(watch, "goto");
    assert.deepEqual(
      [watch.locatorOf("shop", "Customer Profile", false), watch.locatorOf("shop", "Phone: 055 222 41 11", false), watch.locatorOf("shop", "Open", false)],
      [
        { locator: 'page.getByText("Customer Profile", { exact: true })', field: false, count: 1 },
        // A text YAML quotes is read without its quotes.
        { locator: 'page.getByText("Phone: 055 222 41 11", { exact: true })', field: false, count: 1 },
        // Several elements show it: the table, a part told by its role alone, holds one of them alone.
        { locator: 'page.getByText("Open", { exact: true })', field: false, count: 3, narrower: 'page.getByRole("table").getByText("Open", { exact: true })' },
      ],
    );
    // A field is counted by its name, never by what it holds, and a text too short tells nothing.
    assert.deepEqual(
      asked.filter((target) => target.within === undefined).map((target) => ("text" in target ? target.text : target.name)),
      ["Customer Profile", "Phone: 055 222 41 11", "Open", "Search"],
    );
  });

  it("gives no element of its own to a part of the text of an element, which a test finds by the text", async () => {
    const asked: CheckedTarget[] = [];
    const matches: TargetMatcher = async (_application, targets) =>
      targets.map((target) => (asked.push(target), { code: "<counted>", count: 0, visible: false }));
    const shown = ["- paragraph:", "  - text: Lakeside Mutual has not yet responded to this request.", '  - button "Respond"'].join("\n");
    const watch = new ScreenWatch(["shop"], page([shown]).tools, matches);
    await run(watch, "goto");
    // A locator by its exact text designates no element: the paragraph also holds the name of the button.
    assert.equal(watch.locatorOf("shop", "Lakeside Mutual has not yet responded to this request.", false), undefined);
    assert.deepEqual(
      asked.map((target) => ("text" in target ? target.text : target.name)),
      ["Respond"],
    );
  });

  it("gives an element whose locator designates it alone first, else one several share, else the field, else one the page did not show", async () => {
    const field = '- textbox "Search": Ghost → page.getByRole("textbox", { name: "Search", exact: true })';
    const matches: TargetMatcher = async (_application, targets) =>
      named(targets).map(({ role, name }) => ({ code: `<${role} ${name}>`, count: name === "Ghost" ? 0 : role === "cell" ? 2 : 1, visible: true }));
    const watch = new ScreenWatch(
      ["shop"],
      page([`- cell "Active"\n- heading "Active"\n- cell "Ghost"\n- cell "Lost"\n- cell "Framed" → inside a frame: these tools cannot reach it\n${field}`])
        .tools,
      matches,
    );
    await run(watch, "goto");
    assert.deepEqual(
      [
        watch.locatorOf("shop", "Active", false),
        watch.locatorOf("shop", "Lost", false),
        watch.locatorOf("shop", "Ghost", false),
        watch.locatorOf("shop", "Ghost", true),
        // An element the tools cannot reach is none a test finds.
        watch.locatorOf("shop", "Framed", false),
      ],
      [
        { locator: "<heading Active>", field: false, count: 1 },
        { locator: "<cell Lost>", field: false, count: 2 },
        { locator: 'page.getByRole("textbox", { name: "Search", exact: true })', field: true, count: 1 },
        { locator: "<cell Ghost>", field: false, count: 0 },
        undefined,
      ],
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
    const shown = (locator: string, field = false) => ({ locator, field, count: 1 });
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

  it("numbers each action whose tool returned its line of code, whatever its application, and keeps it with what it typed", async () => {
    let count = 0;
    const coded = (name: string): ToolDefinition => ({
      name,
      description: name,
      parameters: { type: "object" },
      execute: async () => (name.endsWith("_snapshot") ? { page: LIST, truncated: false } : { url: "/orders", code: `line ${(count += 1)}` }),
    });
    const actions = ["goto", "snapshot", "click", "fill", "select_option", "check"];
    const watch = new ScreenWatch(
      ["shop", "desk", "ledger"],
      [...actions.map((action) => coded(`shop_${action}`)), ...actions.map((action) => coded(`desk_${action}`))],
    );
    const call = (name: string, args: object = {}) =>
      watch
        .tools()
        .find((tool) => tool.name === name)!
        .execute(args);
    assert.deepEqual(await call("shop_goto", { url: "/orders" }), { url: "/orders", code: "line 1", action: 1, page: SHOWN, truncated: false });
    assert.deepEqual(await call("shop_fill", { value: "Veldane" }), {
      url: "/orders",
      code: "line 2",
      action: 2,
      appeared: "Nothing new appeared on the page.",
      gone: "Nothing went from the page.",
    });
    await call("shop_snapshot");
    await call("desk_goto", { url: "/" });
    await call("shop_fill", { value: { account: "demo", field: "password" } });
    await call("shop_select_option", { option: "Paid" });
    await call("shop_check", { checked: true });
    await call("shop_click");
    assert.deepEqual(watch.action(2), { number: 2, application: "shop", tool: "fill", code: "line 2", typed: "Veldane", screen: "/orders" });
    assert.deepEqual(watch.action(3), { number: 3, application: "desk", tool: "goto", code: "line 3", screen: "/orders", opened: "/" });
    // The credential of an account is no text the agent typed; an option chosen is one.
    assert.deepEqual(watch.action(4), { number: 4, application: "shop", tool: "fill", code: "line 4", screen: "/orders" });
    assert.deepEqual(watch.action(5), { number: 5, application: "shop", tool: "select_option", code: "line 5", typed: "Paid", screen: "/orders" });
    assert.deepEqual([watch.action(0), watch.action(8)], [undefined, undefined]);
    assert.deepEqual(
      [watch.actions("shop").map((action) => action.number), watch.actions("desk").map((action) => action.number), watch.actions("ledger")],
      [[1, 2, 4, 5, 6, 7], [3], []],
    );
    // The last five lines of code of an application, the last first.
    assert.deepEqual([watch.codes("shop"), watch.codes("ledger")], [["line 7", "line 6", "line 5", "line 4", "line 2"], []]);
  });

  it("says in the description of each tool what it adds to its result", () => {
    const state = "Returns where the page is, and the line of code that does the same in a test.";
    const tools = page([LIST]).tools.map((tool) => ({ ...tool, description: `Acts on the page. ${state}` }));
    const described = new Map(new ScreenWatch(["shop"], tools).tools().map((tool) => [tool.name, tool.description]));
    assert.deepEqual(
      [described.get("shop_goto"), described.get("shop_click"), described.get("shop_snapshot")],
      [
        'Acts on the page. Returns what the page shows, the line of code that does the same in a test, and "action", its number: a plan cites it in the steps the action does.',
        'Acts on the page. Returns what appeared, what went, the line of code that does the same in a test, and "action", its number: a plan cites it in the steps the action does.',
        `Acts on the page. ${state}`,
      ],
    );
  });
});

describe("the screens of several applications, taken as one for a test that acts on each", () => {
  const tools = (): ToolDefinition[] =>
    ["shop", "desk"].flatMap((application) =>
      ["goto", "snapshot", "click", "fill", "select_option", "check"].map((action) => ({
        name: `${application}_${action}`,
        description: action,
        parameters: { type: "object" },
        execute: async () =>
          action === "snapshot"
            ? { page: `- heading "The ${application}"\n- textbox "Search": about ${application}`, truncated: false }
            : { url: `/${application}`, code: `await page.goto("/${application}");` },
      })),
    );

  it("answers about a scope what it answers about each of its applications, and about one application for a scope of one", async () => {
    const watch = new ScreenWatch(["shop", "desk", "ledger"], tools());
    const call = (name: string) =>
      watch
        .tools()
        .find((tool) => tool.name === name)!
        .execute({});
    await call("shop_goto");
    await call("desk_goto");
    const both = scenarioScope({ application: "shop", applications: ["desk"] });
    assert.deepEqual([both, scenarioScope({ application: "shop" }), screenScope(["shop", "shop"])], ["shop+desk", "shop", "shop"]);
    assert.deepEqual(
      [
        watch.shows(both, "The shop"),
        watch.shows(both, "The desk"),
        watch.shows("shop", "The desk"),
        watch.looks(both),
        watch.watches(both),
        watch.watches("ledger"),
      ],
      [true, true, false, 2, true, false],
    );
    assert.deepEqual(
      watch.actions(both).map((action) => [action.number, action.application, action.screen]),
      [
        [1, "shop", "/shop"],
        [2, "desk", "/desk"],
      ],
    );
    // A value a field held is dated across the applications; a page the runner showed is kept by each.
    assert.deepEqual([watch.typedAt(both, "about shop") !== undefined, watch.typedAt(both, "about desk") !== undefined], [true, true]);
    watch.recordPage(both, ['- heading "Failed here"']);
    assert.deepEqual([watch.shows("shop", "Failed here"), watch.shows("desk", "Failed here")], [true, true]);
  });
});

describe("a page the harness looks at by itself", () => {
  /** Browser tools of a shop whose home shows its orders, until it is told they are gone. */
  const shop = () => {
    const state = { gone: false, down: false, opened: [] as string[] };
    const tool = (action: string, execute: (args: { url?: string }) => unknown): ToolDefinition => ({
      name: `shop_${action}`,
      description: action,
      parameters: { type: "object" },
      execute: async (args) => execute(args as { url?: string }),
    });
    const tools = [
      tool("goto", ({ url = "/" }) => {
        if (state.down) throw new Error("The page did not answer.");
        state.opened.push(url);
        return { url, code: `await page.goto(${JSON.stringify(url)});` };
      }),
      tool("snapshot", () => ({
        page: state.gone ? '- heading "Shop"' : '- heading "Shop"\n- row "ORD-1042 Mira Veldane"\n- textbox "Search": Veldane',
        truncated: false,
      })),
      ...["click", "fill", "select_option", "check"].map((action) => tool(action, () => ({ code: `await page.${action}();` }))),
    ];
    return { state, watch: new ScreenWatch(["shop"], tools) };
  };

  it("says which texts the page no longer shows beside its fields, without the look counting as one of the agent", async () => {
    const { state, watch } = shop();
    assert.deepEqual(await watch.missingAt("shop", "/orders", ["ORD-1042", "Shop"]), []);
    // What a field holds is no text the page shows.
    assert.deepEqual(await watch.missingAt("shop", "/orders", ["Veldane", "ORD-1042"]), []);
    state.gone = true;
    assert.deepEqual(await watch.missingAt("shop", "/orders", ["ORD-1042", "Shop"]), ["ORD-1042"]);
    assert.deepEqual(
      [state.opened, watch.actions("shop"), watch.looks("shop"), watch.shows("shop", "Shop")],
      [["/orders", "/orders", "/orders"], [], 0, false],
    );
  });

  it("answers nothing of a page it could not open", async () => {
    const { state, watch } = shop();
    state.down = true;
    assert.equal(await watch.missingAt("shop", "/orders", ["Shop"]), undefined);
  });
});

describe("the screens the actions of the agent left the page on", () => {
  it("are named once each, by their application and their route, in the order the agent reached them", async () => {
    const tool = (action: string, url: string): ToolDefinition => ({
      name: `shop_${action}`,
      description: action,
      parameters: { type: "object" },
      execute: async () => ({ url, code: `await page.${action}();` }),
    });
    const snapshot: ToolDefinition = { ...tool("snapshot", ""), execute: async () => ({ page: "", truncated: false }) };
    const orders = "http://127.0.0.1/orders";
    const tools = [tool("goto", orders), tool("click", `${orders}/42`), tool("fill", orders), tool("select_option", orders), tool("check", orders), snapshot];
    const watch = new ScreenWatch(["shop"], tools);
    assert.deepEqual(watch.visited(), []);
    for (const action of ["goto", "click", "fill"]) await run(watch, action);
    assert.deepEqual(watch.visited(), ["shop /orders", "shop /orders/:id"]);
  });
});
