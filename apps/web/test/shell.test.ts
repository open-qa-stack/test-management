import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Shell } from "../src/shell.tsx";

describe("shell", () => {
  it("frames the page between the sidebar and the tab bar", () => {
    const html = renderToStaticMarkup(createElement(Shell, null, createElement("p", null, "page")));
    assert.equal(
      html,
      '<div class="shell"><aside class="shell-sidebar"></aside><main class="shell-page"><p>page</p></main><nav class="shell-tab-bar"></nav></div>',
    );
  });
});
