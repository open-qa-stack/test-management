import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { CartographyState } from "@open-qa-stack/domain/sessions";
import { DiscoveryScreen, type DiscoveryControls, type DiscoveryScreenProps } from "../../src/discovery/discovery-screen.tsx";
import { at, linksOf, render, textOf } from "../render.ts";

/** What the person does on the screen, which a static rendering never calls. */
const CONTROLS: DiscoveryControls = {
  toggle: () => assert.fail("nothing is picked"),
  generate: () => assert.fail("nothing is opened"),
  exclude: () => assert.fail("nothing is excluded"),
  restore: () => assert.fail("nothing is taken back"),
  rename: () => assert.fail("nothing is renamed"),
};

/** Two sources, one mapped and one being mapped, put together by domain. */
const MAPPING: CartographyState = {
  environment: "local",
  sources: [
    { id: "contract", type: "openapi", state: "mapped", mappedAt: "2026-11-22T09:00:00.000Z" },
    { id: "orders", type: "postgresql", state: "mapping" },
  ],
  knowledgeBase: { producedAt: "2026-11-22T09:00:00.000Z", status: "complete" },
};

/** Two domains the cartography found, the second of sources of two applications and of the whole project. */
const DOMAINS = [
  {
    id: "customers",
    label: "Clients",
    description: "La recherche et la fiche d’un client.",
    sources: [{ id: "contract", applications: ["shop"], items: ["customers"] }],
  },
  {
    id: "orders",
    label: "Commandes",
    description: "La commande et son suivi.",
    sources: [
      { id: "contract", applications: ["shop"], items: ["orders", "carts"] },
      { id: "stock", applications: ["warehouse"], items: ["public.items"] },
      { id: "guide", applications: [], items: ["Passer commande"] },
    ],
  },
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
      route: at("#/discovery"),
      changing: { pending: false },
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
          createElement(DiscoveryScreen, {
            project: "shop-tests",
            chosen: new Set<string>(),
            opening: { state: "idle" },
            route: at("#/discovery"),
            changing: { pending: false },
            controls: CONTROLS,
            ...reading,
          }),
        ),
      ),
      "shop-tests / Découverte Découverte Lecture de la cartographie Elle apparaît dès que l’instance a répondu.",
    );
    assert.match(
      textOf(
        render(
          createElement(DiscoveryScreen, {
            project: "p",
            unread: "Down.",
            chosen: new Set<string>(),
            opening: { state: "idle" },
            route: at("#/discovery"),
            changing: { pending: false },
            controls: CONTROLS,
          }),
        ),
      ),
      /Lecture de la cartographie Down\.$/,
    );
  });

  it("shows where the cartography of each source stands, and the domains it found, each to pick, with nothing to write before one is", () => {
    const html = screen();
    const text = textOf(html);
    assert.match(
      text,
      /Domaines Clients La recherche et la fiche d’un client\. shop D’où il vient : 1 source contract · shop — customers Renommer Exclure Commandes La commande et son suivi\. shop warehouse Tout le projet D’où il vient : 3 sources contract · shop — orders, carts stock · warehouse — public\.items guide · Tout le projet — Passer commande Renommer Exclure Aucun domaine choisi sur 2 Générer les tests Sources · 2 lues par la cartographie Cartographiée · 1 Cartographie en cours · 1 Base de connaissance mise en commun par domaine le .* Voir chaque source contract Cartographiée orders Cartographie en cours$/,
    );
    assert.match(html, /<input id="domain-customers" type="checkbox" name="domain" value="customers"\/>/);
    assert.match(html, /<button type="submit" class="btn primary" disabled="">Générer les tests<\/button>/);
  });

  it("names, on each domain, the applications its sources describe, then each source with its applications and what it holds of the domain", () => {
    const html = screen();
    assert.match(
      html,
      /<div class="domain-sources small"><span class="domain-marks"><span class="badge neutral sq">shop<\/span><span class="badge neutral sq">warehouse<\/span><span class="badge neutral sq">Tout le projet<\/span><\/span><details><summary>D’où il vient : 3 sources<\/summary><ul><li><b>contract<\/b> · shop — <span class="muted">orders, carts<\/span><\/li>/,
    );
    // What the domain comes from sits apart from what picks it.
    assert.match(html, /<label class="tile-pick" for="domain-orders"><span class="tile-head"><b>Commandes<\/b>.*?<\/label><div class="domain-sources small">/s);
  });

  it("sets the domains a person excluded apart, to take back, and says it when every one is, and why a change was refused", () => {
    const [customers, orders] = DOMAINS as [(typeof DOMAINS)[0], (typeof DOMAINS)[0]];
    const html = screen({ domains: [{ ...customers, excluded: true }, orders] });
    assert.match(
      textOf(html),
      /sur 1 Générer les tests Domaines exclus · Les agents n’y travaillent pas\. Clients La recherche et la fiche d’un client\. Réintégrer Sources/,
    );
    assert.doesNotMatch(html, /id="domain-customers"/);
    assert.match(
      textOf(screen({ domains: [{ ...customers, excluded: true }], changing: { pending: false, refusal: "Refusé." } })),
      /Tous les domaines sont exclus Refusé\. Domaines exclus/,
    );
  });

  it("renames a domain in a panel, which tells the name the cartography gave, and why a name was refused", () => {
    const named = DOMAINS.map((domain) => (domain.id === "orders" ? { ...domain, label: "Ventes", foundLabel: "Commandes" } : domain));
    const html = screen({ domains: named, route: at("#/discovery?panel=rename%3Aorders"), changing: { pending: false, refusal: "Refusé." } });
    assert.match(textOf(html), /Nom du domaine Nom La cartographie l’a nommé « Commandes »\. Refusé\. Annuler Enregistrer Sources/);
    assert.match(html, /name="label" value="Ventes"|value="Ventes"/);
    assert.doesNotMatch(textOf(screen({ route: at("#/discovery?panel=rename%3Aorders") })), /La cartographie l’a nommé/);
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
