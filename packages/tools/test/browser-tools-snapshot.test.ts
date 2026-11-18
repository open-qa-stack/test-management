import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { type Page } from "playwright-core";
import { readFacts, sameElement } from "../src/browser/element-facts.ts";
import { readScope, type ScopeElement } from "../src/browser/element-scope.ts";
import { MAX_ANNOTATED_ELEMENTS, MAX_SNAPSHOT_LENGTH, pageSnapshot } from "../src/browser/page-snapshot.ts";
import { recommendTarget } from "../src/browser/recommended-target.ts";
import { withTools, page, line, reject } from "./browser-tools-support.ts";

describe("criterion 2 — a snapshot lists the elements one can act on, with role, name and recommended locator", () => {
  it("recommends the locator by role and name, then label, then test id, then text, in that order", async () => {
    await withTools(async (tool) => {
      const text = await page(tool);
      assert.match(line(text, 'button "Sign in"'), / → page\.getByRole\("button", \{ name: "Sign in", exact: true \}\)$/);
      assert.match(line(text, 'textbox "Email"'), / → page\.getByRole\("textbox", \{ name: "Email", exact: true \}\)$/);
      assert.match(text.split("\n").filter((l) => l.includes('textbox "Promo Code"'))[0]!, / → page\.getByLabel\("Promo", \{ exact: true \}\)$/);
      assert.deepEqual(
        text
          .split("\n")
          .filter((l) => l.includes('button "Save"'))
          .map((l) => l.split(" → ")[1]),
        ['page.getByTestId("save-draft")', 'page.getByTestId("save-final")'],
      );
      assert.match(line(text, "Price: 10"), /^ *- 'button "Price: 10" \[ref=e\d+\]' → page\.getByRole\("button", \{ name: "Price: 10", exact: true \}\)$/);
      assert.match(line(text, "It''s: ok"), / → page\.getByRole\("button", \{ name: "It's: ok", exact: true \}\)$/);
      assert.match(line(text, "listitem"), /listitem \[ref=e\d+\] \[cursor=pointer\]: Policy 42 → page\.getByRole\("listitem"\)$/);
      assert.deepEqual(
        text
          .split("\n")
          .filter((l) => l.includes('button "✕"'))
          .map((l) => l.split(" → ")[1]),
        ['page.getByTestId("delete-1")', 'page.getByTestId("delete-2")'],
      );
      assert.match(line(text, "Card"), /generic \[ref=e\d+\] \[cursor=pointer\]: Card → page\.getByText\("Card", \{ exact: true \}\)$/);
      assert.match(line(text, "checkbox"), / → page\.getByRole\("checkbox"\)$/);
    });
  });

  it("reads one part of the page, with the locators of its elements, and says when that part is not on the page", async () => {
    await withTools(
      async (tool) => {
        const part = ((await tool("shop_snapshot").execute({ within: { role: "combobox", name: "Kind" } })) as { page: string }).page;
        assert.match(part, /^- combobox "Kind" \[ref=e\d+\]: → page\.getByRole\("combobox", \{ name: "Kind", exact: true \}\)\n/);
        assert.match(part, /option "Car"/);
        assert.doesNotMatch(part, /My Policies/);
        await reject(
          tool("shop_snapshot").execute({ within: { role: "dialog" } }),
          /^page\.getByRole\("dialog"\) matches no element\.\n\nThe page is now at .*\n- generic/,
        );
        await reject(
          tool("shop_snapshot").execute({ within: { text: "Again" } }),
          /^page\.getByText\("Again", \{ exact: true \}\) matches 2 elements, and no locator the test charter allows tells them apart/,
        );
      },
      { actionTimeoutMs: 300 },
    );
  });

  it("says when no locator matches one element only, and when none applies", async () => {
    await withTools(async (tool) => {
      const text = await page(tool);
      assert.match(line(text, 'button "Again"'), / → no unique locator: 2 elements match page\.getByRole\("button", \{ name: "Again", exact: true \}\)$/);
      assert.match(line(text, "open"), / → page\.getByText\("open", \{ exact: true \}\)$/);
      assert.match(text, /generic \[ref=e\d+\] \[cursor=pointer\] → no locator by role, label, test id or text$/m);
      assert.doesNotMatch(line(text, "Nested card"), /getByText/);
      assert.match(line(text, 'button "Inside"'), / → inside a frame: these tools cannot reach it$/);
      assert.match(line(text, 'button "Locked"'), / → page\.getByRole/);
      assert.doesNotMatch(line(text, 'heading "My Policies"'), /→/);
    });
  });

  it("recommends, for an element repeated on each row, its locator inside the row named by its first cell, and acts on it", async () => {
    await withTools(async (tool) => {
      await tool("shop_goto").execute({ url: "/rows" });
      const text = await page(tool);
      const manage = text
        .split("\n")
        .filter((l) => l.includes('button "Manage"'))
        .map((l) => l.split(" → ")[1]);
      assert.deepEqual(manage, [
        'page.getByRole("row", { name: "Lena Veldane" }).getByRole("button", { name: "Manage", exact: true })',
        'page.getByRole("row", { name: "Tom Arvel" }).getByRole("button", { name: "Manage", exact: true })',
      ]);
      assert.deepEqual(
        text
          .split("\n")
          .filter((l) => l.includes('button "Close"'))
          .map((l) => l.split(" → ")[1]),
        [
          'page.getByRole("dialog").getByRole("button", { name: "Close", exact: true })',
          'no unique locator: 2 elements match page.getByRole("button", { name: "Close", exact: true })',
        ],
      );
      assert.match(line(text, 'button "Open"'), / → no unique locator: 2 elements match page\.getByRole\("button", \{ name: "Open", exact: true \}\)$/);
      assert.match(line(text, 'button "Edit"'), / → no unique locator: 2 elements match page\.getByRole\("button", \{ name: "Edit", exact: true \}\)$/);
      // A button its row tells apart is one the agent can reach: the locator it gave is only too broad.
      await reject(
        tool("shop_click").execute({ target: { role: "button", name: "Manage" } }),
        /^page\.getByRole\("button", \{ name: "Manage", exact: true \}\) matches more than one element; use a locator that matches one\./,
      );
      const clicked = (await tool("shop_click").execute({ target: { role: "button", name: "Manage", within: { role: "row", name: "Lena Veldane" } } })) as {
        code: string;
      };
      assert.equal(clicked.code, `await ${manage[0]}.click();`);
      assert.match(await page(tool), /paragraph \[ref=\w+\]: Managing Lena$/m);
      const part = ((await tool("shop_snapshot").execute({ within: { text: "Close", within: { role: "dialog" } } })) as { page: string }).page;
      assert.match(part, /^- button "Close"/);
      // The name of a row is the text of all its cells: a part of the page is named by a part of its name.
      const row = ((await tool("shop_snapshot").execute({ within: { role: "row", name: "Tom Arvel" } })) as { page: string }).page;
      assert.match(row, /^- row \[ref=\w+\]:\n *- cell "Tom Arvel"/);
      assert.doesNotMatch(row, /Lena Veldane/);
      await reject(
        tool("shop_snapshot").execute({ within: { role: "row", name: "Ida Norr" } }),
        /^page\.getByRole\("row", \{ name: "Ida Norr" \}\) matches no element\./,
      );
    });
  });

  it("clicks an element whose name says it removes data only once the agent confirms it", async () => {
    await withTools(async (tool) => {
      await tool("shop_goto").execute({ url: "/removes" });
      const remove = { role: "button", name: "Delete order" };
      assert.deepEqual(await tool("shop_click").execute({ target: remove }), {
        error:
          'Nothing was clicked: "Delete order" may remove data of the application, which every test and every user of the environment share. If the brief asks for this removal, call again with "confirm": true. If you only need to know what it does, read the source, or plan a test that stops before the removal, such as one that cancels its confirmation.',
      });
      assert.deepEqual(
        await tool("shop_click").execute({ target: { text: "Delete order" }, confirm: false }),
        await tool("shop_click").execute({ target: remove }),
      );
      assert.match(await page(tool), /paragraph \[ref=\w+\]: Order 42$/m);
      // Any other element is clicked as before, and the one that removes once confirmed.
      await tool("shop_click").execute({ target: { role: "button", name: "Keep" } });
      assert.match(await page(tool), /Order 42, kept/);
      const clicked = (await tool("shop_click").execute({ target: remove, confirm: true })) as { code: string };
      assert.equal(clicked.code, 'await page.getByRole("button", { name: "Delete order", exact: true }).click();');
      assert.doesNotMatch(await page(tool), /Order 42/);
    });
  });

  it("counts, without the model, the elements a target designates on the page as it is, and tells one the page shows from one it hides", async () => {
    await withTools(async (tool, toolset) => {
      await tool("shop_goto").execute({ url: "/rows" });
      const row = { role: "row", name: "Lena Veldane" };
      assert.deepEqual(
        await toolset.matches("shop", [
          { role: "cell", name: "Lena Veldane" },
          { role: "button", name: "Manage" },
          { role: "button", name: "Manage", within: row },
          { role: "heading", name: "Nowhere" },
        ]),
        [
          { code: 'page.getByRole("cell", { name: "Lena Veldane", exact: true })', count: 1, visible: true },
          { code: 'page.getByRole("button", { name: "Manage", exact: true })', count: 2, visible: false },
          { code: 'page.getByRole("row", { name: "Lena Veldane" }).getByRole("button", { name: "Manage", exact: true })', count: 1, visible: true },
          { code: 'page.getByRole("heading", { name: "Nowhere", exact: true })', count: 0, visible: false },
        ],
      );
      await tool("shop_goto").execute({ url: "/" });
      await tool("shop_click").execute({ target: { role: "button", name: "Dismiss" } });
      assert.deepEqual(await toolset.matches("shop", [{ text: "Banner" }]), [{ code: 'page.getByText("Banner", { exact: true })', count: 1, visible: false }]);
      // An application without a user interface, or that the session does not know, has no page to look at.
      assert.deepEqual([await toolset.matches("ledger", [row]), await toolset.matches("unknown", [row])], [[], []]);
    });
  });

  it("reads the row or dialog that holds an element in the page, named by its first child with a text", () => {
    const element = (
      tagName: string,
      parentElement: ScopeElement | null,
      more: { role?: string; children?: ScopeElement[]; textContent?: string | null } = {},
    ): ScopeElement => ({
      tagName,
      parentElement,
      getAttribute: (name: string) => (name === "role" ? (more.role ?? null) : null),
      children: more.children ?? [],
      textContent: more.textContent ?? null,
    });
    const cell = (textContent: string | null) => element("TD", null, { textContent });
    const button = (parent: ScopeElement) => element("BUTTON", parent);
    const table = element("TABLE", element("BODY", null));
    assert.deepEqual(readScope(button(element("TR", table, { children: [cell(null), cell(" "), cell(" Lena\n Veldane ")] }))), {
      role: "row",
      name: "Lena Veldane",
    });
    assert.deepEqual(readScope(button(element("TD", element("DIV", table, { role: "row", children: [cell("Tom")] })))), { role: "row", name: "Tom" });
    assert.deepEqual(readScope(button(element("TR", null, { children: [cell("")] }))), { role: "row" });
    // A list item takes no name from what it holds, so a locator could not name it.
    assert.equal(readScope(button(element("LI", null, { children: [cell("Lena")] }))), null);
    assert.deepEqual(readScope(button(element("DIV", element("DIALOG", null)))), { role: "dialog" });
    assert.deepEqual(readScope(button(element("TR", null, { role: "presentation" }))), null);
    assert.equal(readScope(element("HTML", null)), null);
  });

  it("recommends a locator for a bounded number of elements, and cuts a long page at a line", async () => {
    await withTools(async (tool) => {
      await tool("shop_goto").execute({ url: "/many" });
      const many = (await tool("shop_snapshot").execute({})) as { page: string; truncated: boolean };
      assert.ok(many.page.split("\n").filter((l) => l.includes(" → ")).length <= MAX_ANNOTATED_ELEMENTS);
      assert.equal(many.truncated, true);
      await tool("shop_goto").execute({ url: "/text" });
      const long = (await tool("shop_snapshot").execute({})) as { page: string; truncated: boolean };
      assert.equal(long.truncated, true);
      assert.ok(long.page.length <= MAX_SNAPSHOT_LENGTH);
      assert.match(long.page.split("\n").at(-1)!, /Paragraph \d+ with enough words/);
      await tool("shop_goto").execute({ url: "/second" });
      assert.equal(((await tool("shop_snapshot").execute({})) as { truncated: boolean }).truncated, false);
    });
  });

  it("reads the label, test id and text of an element in the page, and tells two elements apart", () => {
    const element = (attributes: Record<string, string>, more: object = {}) => ({
      getAttribute: (name: string) => attributes[name] ?? null,
      textContent: null,
      ...more,
    });
    assert.deepEqual(readFacts(element({ "data-testid": "t" }, { labels: [{ textContent: " Promo " }], textContent: " Go\n  now " })), {
      testId: "t",
      label: "Promo",
      text: "Go now",
    });
    assert.deepEqual(readFacts(element({ "aria-label": "Code" }, { labels: [], textContent: "" })), { testId: null, label: "Code", text: "" });
    assert.deepEqual(readFacts(element({ "aria-label": "" }, { labels: [{ textContent: null }] })), { testId: null, label: null, text: "" });
    assert.deepEqual(readFacts(element({}, { labels: null })), { testId: null, label: null, text: "" });
    const one = {};
    assert.deepEqual([sameElement(one, one), sameElement(one, {})], [true, false]);
  });

  it("marks an element the page replaced while the snapshot was taken, without failing the snapshot", async () => {
    const gone = { getByRef: () => ({ elementHandles: () => Promise.reject(new Error("element was detached")) }) };
    assert.deepEqual(await recommendTarget(gone as unknown as Page, "e1", "button", "Save"), { kind: "changed" });
    let disposed = false;
    const handle = { evaluate: () => Promise.reject(new Error("element was detached")), dispose: async () => void (disposed = true) };
    const replaced = { getByRef: () => ({ elementHandles: async () => [handle] }) };
    assert.deepEqual(await recommendTarget(replaced as unknown as Page, "e1", "button", "Save"), { kind: "changed" });
    assert.equal(disposed, true);
    const page = { ...gone, ariaSnapshot: async () => '- button "Save" [ref=e1]', url: () => "http://shop.test/", title: async () => "Shop" };
    assert.deepEqual(await pageSnapshot(page as unknown as Page), {
      url: "http://shop.test/",
      title: "Shop",
      page: '- button "Save" [ref=e1] → the element changed while the snapshot was taken; take another one',
      truncated: false,
    });
  });
});
