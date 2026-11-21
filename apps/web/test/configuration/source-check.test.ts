import assert from "node:assert/strict";
import type { Knowledge } from "@open-qa-stack/domain/sessions";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { SourceTest } from "../../src/configuration/configuration-state.ts";
import { KnowledgeCard } from "../../src/configuration/knowledge-card.tsx";
import { render, textOf } from "../render.ts";

const DOCS: Knowledge = { id: "docs", type: "document", path: "docs", attachments: [] };
const LOGS: Knowledge = { id: "server", type: "logs", path: "server.log", attachments: [] };

/** The card of a source, with the latest test of a source. */
const card = (source: Knowledge, test?: SourceTest): string =>
  render(
    createElement(KnowledgeCard, {
      source,
      rank: 2,
      applications: [],
      onCheck: () => assert.fail("nothing is tested"),
      ...(test === undefined ? {} : { test }),
    }),
  );

describe("the test of a source, on its card", () => {
  it("is offered for every source but logs, by the rank of the source", () => {
    assert.match(card(DOCS), /<button type="button" class="btn sm" data-rank="2">Tester la connexion<\/button>/);
    assert.doesNotMatch(card(LOGS), /Tester la connexion/);
  });

  it("says it runs, then what it found in plain words", () => {
    assert.match(card(DOCS, { source: DOCS }), /disabled="">Tester la connexion<\/button>.*Test en cours…/s);
    assert.match(textOf(card(DOCS, { source: DOCS, check: { state: "ok", items: 0 } })), /Connexion réussie, mais la source ne contient rien pour l’instant\./);
    assert.match(textOf(card(DOCS, { source: DOCS, check: { state: "ok", items: 1 } })), /Connexion réussie · 1 élément trouvé\./);
    assert.match(textOf(card(DOCS, { source: DOCS, check: { state: "ok", items: 12 } })), /Connexion réussie · 12 éléments trouvés\./);
    assert.match(textOf(card(DOCS, { source: DOCS, check: { state: "failed", reason: "ENOENT" } })), /La source ne répond pas : ENOENT/);
    assert.match(
      textOf(card(LOGS, { source: LOGS, check: { state: "unchecked" } })),
      /Les journaux se lisent pendant une session : ils ne se testent pas ici\./,
    );
    assert.match(textOf(card(DOCS, { source: DOCS, failure: "Hors ligne." })), /Le test n’a pas pu être fait : Hors ligne\./);
  });

  it("forgets a test of the source as it was before it changed", () => {
    assert.doesNotMatch(textOf(card({ ...DOCS, path: "other" }, { source: DOCS, check: { state: "ok", items: 1 } })), /Connexion réussie/);
  });
});
