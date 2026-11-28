import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import { Badge } from "../../src/ui/badge.tsx";
import { Card } from "../../src/ui/card.tsx";
import { EmptyState } from "../../src/ui/empty-state.tsx";
import { Icon } from "../../src/ui/icon.tsx";
import { Page } from "../../src/ui/page.tsx";
import { render, textOf } from "../render.ts";

describe("the components of the console", () => {
  it("draws an icon at its size, hidden from assistive technologies", () => {
    assert.match(
      render(createElement(Icon, { name: "export" })),
      /^<svg width="16" height="16"[^>]* aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"\/><\/svg>$/,
    );
    assert.match(render(createElement(Icon, { name: "export", size: 24 })), /^<svg width="24" height="24"/);
  });

  it("draws the line of an icon 1.5 px thick on the screen at every size", () => {
    const strokes = ([12, 16, 20, 24] as const).map((size) => /stroke-width="([^"]+)"/.exec(render(createElement(Icon, { name: "export", size })))![1]);
    assert.deepEqual(strokes, ["3", "2.25", "1.8", "1.5"]);
  });

  it("shows a badge in its tone, square when asked", () => {
    assert.equal(render(createElement(Badge, { tone: "ok", children: "réussi" })), '<span class="badge ok">réussi</span>');
    assert.equal(
      render(createElement(Badge, { tone: "info", square: true, children: "Policy Management" })),
      '<span class="badge info sq">Policy Management</span>',
    );
  });

  it("frames a card with its header when it has a title", () => {
    assert.equal(render(createElement(Card, { children: "content" })), '<section class="card">content</section>');
    assert.equal(
      render(createElement(Card, { title: "Sessions", hint: "les demandes", aside: "3", className: "tbl", children: "content" })),
      '<section class="card tbl"><div class="hd"><span>Sessions</span><span class="sub">· les demandes</span><span class="right">3</span></div>content</section>',
    );
  });

  it("says what is missing, why, and what to do", () => {
    assert.equal(render(createElement(EmptyState, { title: "Aucun test" })), '<div class="state"><b>Aucun test</b></div>');
    assert.equal(
      render(createElement(EmptyState, { title: "Aucun test", action: "créer" }, "Le dépôt est vide.")),
      '<div class="state"><b>Aucun test</b><span>Le dépôt est vide.</span>créer</div>',
    );
  });

  it("heads a page under another with its breadcrumb, a title that can take the focus and its actions, or with the header of an entity", () => {
    const html = render(
      createElement(Page, {
        crumbs: [{ label: "Projet" }, { label: "Tests", href: "#/tests" }, { label: "Un test" }],
        title: "Un test",
        actions: "valider",
        children: "content",
      }),
    );
    assert.equal(textOf(html), "Tests Projet / Tests / Un test Un test valider content");
    assert.match(html, /<span>Projet<\/span>.*<a href="#\/tests">Tests<\/a>.*<b>Un test<\/b>/);
    assert.match(html, /<h1 tabindex="-1">Un test<\/h1>/);
    // A screen of the navigation opens on its title, without a breadcrumb.
    const entity = render(createElement(Page, { crumbs: [{ label: "Tests" }], entity: "entity", children: "content" }));
    assert.equal(entity, '<div class="ph"></div>entity<div class="content">content</div>');
  });
});
