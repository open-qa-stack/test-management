import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import { Badge } from "../../src/ui/badge.tsx";
import { Card } from "../../src/ui/card.tsx";
import { counted } from "../../src/ui/counted.ts";
import { EmptyState } from "../../src/ui/empty-state.tsx";
import { Icon } from "../../src/ui/icon.tsx";
import { Page } from "../../src/ui/page.tsx";
import { render, textOf } from "../render.ts";

describe("the components of the console", () => {
  it("draws an icon at its size, hidden from assistive technologies", () => {
    assert.match(render(createElement(Icon, { name: "check" })), /^<svg width="16" height="16"[^>]* aria-hidden="true"><path d="M5 12l5 5L20 7"\/><\/svg>$/);
    assert.match(render(createElement(Icon, { name: "check", size: 24 })), /^<svg width="24" height="24"/);
  });

  it("draws the line of an icon 1.5 px thick on the screen at every size", () => {
    const strokes = ([12, 16, 20, 24] as const).map((size) => /stroke-width="([^"]+)"/.exec(render(createElement(Icon, { name: "check", size })))![1]);
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

  it("heads a page with its breadcrumb, a title that can take the focus and its actions, or with the header of an entity", () => {
    const html = render(
      createElement(Page, {
        crumbs: [{ label: "Projet" }, { label: "Tests", href: "#/tests" }, { label: "Un test" }],
        title: "Un test",
        actions: "valider",
        children: "content",
      }),
    );
    assert.equal(textOf(html), "Projet / Tests / Un test Un test valider content");
    assert.match(html, /<span>Projet<\/span>.*<a href="#\/tests">Tests<\/a>.*<b>Un test<\/b>/);
    assert.match(html, /<h1 tabindex="-1">Un test<\/h1>/);
    const entity = render(createElement(Page, { crumbs: [{ label: "Tests" }], entity: "entity", children: "content" }));
    assert.equal(entity, '<div class="ph"><div class="crumb"><span class="crumb-step"><b>Tests</b></span></div></div>entity<div class="content">content</div>');
  });
});

describe("a count with what it counts", () => {
  it("is in the singular below two, zero included, and in the plural from two", () => {
    assert.deepEqual(
      [0, 1, 2, 12].map((count) => counted(count, "scénario", "scénarios")),
      ["0 scénario", "1 scénario", "2 scénarios", "12 scénarios"],
    );
  });
});
