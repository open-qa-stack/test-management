import assert from "node:assert/strict";
import { createElement, type ChangeEvent } from "react";
import { describe, it } from "vitest";
import type { RepositoryTest } from "@open-qa-stack/domain/sessions";
import { CampaignComposer, type ComposerProps } from "../../src/campaigns/campaign-composer.tsx";
import { EVERY_TEST, testKey, type CompositionFilter } from "../../src/campaigns/campaign-composition.ts";
import { elementsOf, render, textOf } from "../render.ts";
import { nameApplications } from "../../src/applications/application-names.ts";

/** Two tests of the repository, one of each level. */
const HOME: RepositoryTest = {
  path: "apps/a/home.spec.ts",
  title: "Open the home",
  steps: [],
  tags: ["@level-smoke"],
  applications: ["a"],
  level: "smoke",
  domain: "home",
};
const ORDER: RepositoryTest = { path: "apps/a/order.spec.ts", title: "Place an order", steps: [], tags: [], applications: ["a"] };

/** What the composer is given, with what it says recorded. */
function composerOf(changes: Partial<ComposerProps> = {}): { props: ComposerProps; told: unknown[] } {
  const told: unknown[] = [];
  const props: ComposerProps = {
    tests: { value: [HOME, ORDER] },
    filter: EVERY_TEST,
    chosen: new Set([testKey(HOME)]),
    changed: false,
    saving: false,
    onFilter: (filter) => told.push(["filter", filter]),
    onTick: (keys, ticked) => told.push(["tick", keys, ticked]),
    onSave: () => told.push(["save"]),
    ...changes,
  };
  return { props, told };
}

/** The composer as HTML. */
const html = (changes: Partial<ComposerProps> = {}): string => render(createElement(CampaignComposer, composerOf(changes).props));

/** An event of a field whose value, or whose tick, is the one given. */
const event = (value: string, checked = false) => ({ currentTarget: { value, checked } }) as unknown as ChangeEvent<HTMLInputElement & HTMLSelectElement>;

describe("the composition of a planned campaign", () => {
  it("lists the tests of the repository, each ticked when it is chosen, with its level, domain and applications by their names, and how many are chosen", () => {
    nameApplications([{ id: "a", name: "Shop" }]);
    const text = textOf(html());
    nameApplications([]);
    assert.match(
      text,
      /^Tests de la campagne 1 choisis sur 2 Filtrer par mots Niveau tous Vérification rapide Domaine tous home Application tous Shop Tag tous @level-smoke Seulement la sélection 2 tests affichés/,
    );
    assert.match(text, /Open the home Vérification rapide home Shop Place an order Shop Sélection enregistrée\. Enregistrer la sélection \(1 test\)$/);
    assert.match(html(), /<label class="row campaign-composer-test ticked"><input type="checkbox" checked=""\/>/);
  });

  it("says the choice changed until it is kept, and that it is being kept", () => {
    assert.match(textOf(html({ changed: true })), /Sélection modifiée, pas encore enregistrée\. Enregistrer la sélection/);
    assert.match(html({ changed: true, saving: true }), /disabled="">Enregistrement…<\/button>/);
  });

  it("says no test matches the filters, the repository holds none, or it reads them", () => {
    assert.match(textOf(html({ filter: { ...EVERY_TEST, words: "nothing" } })), /0 test affiché .* Aucun test ne correspond à ces filtres\./);
    assert.match(textOf(html({ tests: { value: [] } })), /^Aucun test dans le dépôt/);
    assert.match(textOf(html({ tests: {} })), /^Lecture des tests du dépôt Ils apparaissent/);
    assert.match(textOf(html({ tests: { unread: "Down." } })), /Down\.$/);
  });

  it("narrows the tests, ticks them one by one or those shown at once, and keeps the choice", () => {
    const { props, told } = composerOf({ changed: true });
    const node = createElement(CampaignComposer, props);
    const [search] = elementsOf(node, "input").filter((input) => input["type"] === "search");
    (search!["onChange"] as (event: unknown) => void)(event("home"));
    const selects = elementsOf(node, "select");
    for (const [rank, select] of selects.entries()) (select["onChange"] as (event: unknown) => void)(event(rank === 0 ? "smoke" : ""));
    const boxes = elementsOf(node, "input").filter((input) => input["type"] === "checkbox");
    (boxes[0]!["onChange"] as (event: unknown) => void)(event("", true));
    (boxes[1]!["onChange"] as (event: unknown) => void)(event("", false));
    for (const button of elementsOf(node, "button")) (button["onClick"] as () => void)();
    const filters = told.filter((said) => (said as unknown[])[0] === "filter").map((said) => (said as [string, CompositionFilter])[1]);
    assert.deepEqual(filters, [
      { ...EVERY_TEST, words: "home" },
      { ...EVERY_TEST, level: "smoke" },
      { ...EVERY_TEST, domain: undefined },
      { ...EVERY_TEST, application: undefined },
      { ...EVERY_TEST, tag: undefined },
      { ...EVERY_TEST, chosenOnly: true },
    ]);
    assert.deepEqual(
      told.filter((said) => (said as unknown[])[0] !== "filter"),
      [["tick", [testKey(HOME)], false], ["tick", [testKey(HOME), testKey(ORDER)], true], ["tick", [testKey(HOME), testKey(ORDER)], false], ["save"]],
    );
  });
});
