import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import { CodeLines } from "../../src/ui/code.tsx";
import { loadCodeColours } from "../../src/ui/code-colours.ts";
import { CodeColoursStore } from "../../src/ui/code-colours-store.ts";
import { render } from "../render.ts";

const TEST = ['test("Search a customer", async ({ page }) => {', "", '  await page.goto("/customers"); // the list', "});"];

describe("a block of code", () => {
  it("colours each run of a test with a variable of the sheet, a line for a line, and keeps an empty line", async () => {
    const highlight = await loadCodeColours();
    const html = render(createElement(CodeLines, { lines: TEST, className: "look-code", colours: highlight }));
    assert.equal(html.match(/<span class="code-line">/g)?.length, 4);
    assert.match(html, /^<pre class="look-code code mono">/);
    assert.match(html, /<span style="color:var\(--code-token-string-expression\)">&quot;Search a customer&quot;<\/span>/);
    assert.match(html, /<span style="color:var\(--code-token-keyword\)">await<\/span>/);
    assert.match(html, /<span style="color:var\(--code-token-comment\)">\/\/ the list<\/span>/);
    assert.match(html, /<span class="code-line"> <\/span>/);
    // A file is coloured once, however often it is drawn.
    assert.equal(highlight(TEST), highlight(TEST));
  });

  it("draws its lines plain until what colours them is loaded", () => {
    assert.equal(
      render(createElement(CodeLines, { lines: ["one", "", "two"], className: "act-code", colours: undefined })),
      '<pre class="act-code code mono"><span class="code-line">one</span><span class="code-line"> </span><span class="code-line">two</span></pre>',
    );
  });
});

describe("what colours code", () => {
  it("is loaded once, when something first draws code, and tells whoever listens", async () => {
    let loads = 0;
    const highlight = () => [];
    const store = new CodeColoursStore(async () => {
      loads += 1;
      return highlight;
    });
    assert.equal(store.snapshot(), undefined);
    const told: string[] = [];
    const first = new Promise<void>((resolve) => store.subscribe(() => (told.push("first"), resolve())));
    const stop = store.subscribe(() => told.push("gone"));
    stop();
    await first;
    store.subscribe(() => told.push("late"));
    assert.deepEqual([loads, told, store.snapshot()], [1, ["first"], highlight]);
  });

  it("leaves code plain when it cannot be loaded", async () => {
    let failed!: () => void;
    const tried = new Promise<void>((resolve) => (failed = resolve));
    const store = new CodeColoursStore(() => {
      failed();
      return Promise.reject(new Error("offline"));
    });
    store.subscribe(() => assert.fail("told although nothing was loaded"));
    await tried;
    await Promise.resolve();
    assert.equal(store.snapshot(), undefined);
  });
});
