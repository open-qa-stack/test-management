import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { CartographyState } from "@open-qa-stack/domain/sessions";
import { DiscoveryScreen, type DiscoveryControls, type DiscoveryScreenProps } from "../../src/discovery/discovery-screen.tsx";
import { linksOf, render, textOf } from "../render.ts";

/** What the person does on the screen, which a static rendering never calls. */
const CONTROLS: DiscoveryControls = { toggle: () => assert.fail("nothing is picked"), generate: () => assert.fail("nothing is opened") };

/** Two sources, one mapped and one being mapped, put together by domain. */
const MAPPING: CartographyState = {
  environment: "local",
  sources: [
    { id: "contract", type: "openapi", state: "mapped", mappedAt: "2026-11-22T09:00:00.000Z" },
    { id: "orders", type: "postgresql", state: "mapping" },
  ],
  index: { producedAt: "2026-11-22T09:00:00.000Z", status: "complete" },
};

/** Two domains the cartography found. */
const DOMAINS = [
  { id: "customers", label: "Clients", description: "La recherche et la fiche d’un client." },
  { id: "orders", label: "Commandes", description: "La commande et son suivi." },
];

/** The screen in a state, as HTML. */
const screen = (props: Partial<DiscoveryScreenProps> = {}): string =>
  render(
    createElement(DiscoveryScreen, {
      project: "shop-tests",
      mapping: MAPPING,
      domains: DOMAINS,
      chosen: new Set<string>(),
      opening: { state: "idle" },
      controls: CONTROLS,
      ...props,
    }),
  );

describe("the discovery of the project", () => {
  it("says it reads the cartography until the instance told it, and why it could not", () => {
    const { mapping: _, ...reading } = { mapping: undefined };
    assert.equal(
      textOf(
        render(
          createElement(DiscoveryScreen, { project: "shop-tests", chosen: new Set<string>(), opening: { state: "idle" }, controls: CONTROLS, ...reading }),
        ),
      ),
      "shop-tests / Découverte Découverte Lecture de la cartographie Elle apparaît dès que l’instance a répondu.",
    );
    assert.match(
      textOf(
        render(createElement(DiscoveryScreen, { project: "p", unread: "Down.", chosen: new Set<string>(), opening: { state: "idle" }, controls: CONTROLS })),
      ),
      /Lecture de la cartographie Down\.$/,
    );
  });

  it("shows where the cartography of each source stands, and the domains it found, each to pick, with nothing to write before one is", () => {
    const html = screen();
    const text = textOf(html);
    assert.match(
      text,
      /Domaines Clients La recherche et la fiche d’un client\. Commandes La commande et son suivi\. Aucun domaine choisi sur 2 Générer les tests Sources · 2 lues par la cartographie Cartographiée · 1 Cartographie en cours · 1 Connaissances mises en commun par domaine le .* Voir chaque source contract Cartographiée orders Cartographie en cours$/,
    );
    assert.match(html, /<input id="domain-customers" type="checkbox" name="domain" value="customers"\/>/);
    assert.match(html, /<button type="submit" class="btn primary" disabled="">Générer les tests<\/button>/);
  });

  it("writes the tests of the domains picked, says the session opens, and why it was refused", () => {
    assert.match(
      screen({ chosen: new Set(["orders"]) }),
      /<input id="domain-orders" type="checkbox" name="domain" checked="" value="orders"\/>.*<button type="submit" class="btn primary">Générer les tests de ce domaine<\/button>/s,
    );
    assert.match(screen({ chosen: new Set(["orders", "customers"]) }), />Générer les tests de ces 2 domaines</);
    assert.match(screen({ chosen: new Set(["orders"]), opening: { state: "opening" } }), /disabled="">Ouverture de la session…</);
    assert.match(
      screen({ chosen: new Set(["orders"]), opening: { state: "refused", text: "Refusé." } }),
      /<p class="config-note ko" role="alert">Refusé\.<\/p>/,
    );
  });

  it("says no domain was found yet, and leads to the knowledge, and that no source is declared", () => {
    const html = screen({ domains: [], mapping: { sources: [] } });
    assert.match(
      textOf(html),
      /Aucun domaine pour l’instant Les domaines apparaissent quand la cartographie a lu vos sources et les a mises en commun\. Ouvrir les connaissances Sources · 0 lue par la cartographie Aucune source n’est déclarée$/,
    );
    assert.ok(linksOf(html).includes("#/knowledge"));
  });
});
