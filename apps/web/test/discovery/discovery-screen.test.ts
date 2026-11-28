import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { CartographyState } from "@open-qa-stack/domain/sessions";
import { DiscoveryScreen, shownDomains, type DiscoveryControls, type DiscoveryScreenProps } from "../../src/discovery/discovery-screen.tsx";
import { at, linksOf, render, textOf } from "../render.ts";

/** What the person does on the screen, which a static rendering never calls. */
const CONTROLS: DiscoveryControls = {
  toggle: () => assert.fail("nothing is picked"),
  chooseAll: () => assert.fail("nothing is picked"),
  search: () => assert.fail("nothing is searched"),
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
      /Tout choisir 2 domaines · 2 sources lues le .* · Voir chaque source Domaines Clients La recherche et la fiche d’un client\. 1 application 1 source contract · shop — customers Renommer Exclure Commandes La commande et son suivi\. 2 applications 3 sources contract · shop — orders, carts stock · warehouse — public\.items guide · Tout le projet — Passer commande Renommer Exclure Aucun domaine choisi sur 2 Générer les tests$/,
    );
    assert.match(html, /<input id="domain-customers" type="checkbox" name="domain" value="customers"\/>/);
    assert.match(html, /<button type="submit" class="btn primary" disabled="">Générer les tests<\/button>/);
  });

  it("counts, on each domain, the applications its sources describe, then folds each source with its applications and what it holds of the domain", () => {
    const html = screen();
    assert.match(
      html,
      /<div class="domain-sources small"><span class="muted">2 applications<\/span><details><summary>3 sources<\/summary><ul><li><b>contract<\/b> · shop — <span class="muted">orders, carts<\/span><\/li>/,
    );
    // What the domain comes from sits apart from what picks it, beside the menu that renames and excludes it; its box stands before its name.
    assert.match(
      html,
      /<label class="tile-pick" for="domain-orders"><span class="tile-head"><input id="domain-orders" [^>]*\/><b>Commandes<\/b>.*?<\/label><div class="domain-foot"><div class="domain-sources small">.*?<details class="domain-more"><summary aria-label="Actions du domaine Commandes" title="Actions du domaine">/s,
    );
  });

  it("shows, before any domain, where the cartography of each source stands, and says how many sources a cartography read without a knowledge base", () => {
    const before = textOf(screen({ domains: [] }));
    assert.match(
      before,
      /Sources · 2 lues par la cartographie Cartographiée · 1 Cartographie en cours · 1 .* Voir chaque source contract Cartographiée orders Cartographie en cours$/,
    );
    const { knowledgeBase: _base, ...unbased } = MAPPING;
    assert.match(textOf(screen({ mapping: unbased })), /Tout choisir 2 domaines · 2 sources lues · Voir chaque source Domaines/);
  });

  it("narrows the domains to the words of a search, kept in the address, and says when none matches", () => {
    const html = screen({ route: at("#/discovery?q=COMMANDE%20suivi") });
    assert.doesNotMatch(textOf(html), /Clients La recherche/);
    assert.match(textOf(html), /Commandes La commande et son suivi\./);
    assert.match(
      html,
      /<input type="search" form="discovery-search" aria-label="Chercher un domaine" placeholder="Chercher un domaine" name="q" value="COMMANDE suivi"\/>/,
    );
    assert.match(textOf(screen({ route: at("#/discovery?q=nothing") })), /Aucun domaine ne correspond Cherchez d’autres mots\./);
    assert.match(textOf(screen({ route: at("#/discovery?q=commande"), chosen: new Set(["orders"]) })), /Ne rien choisir/);
    assert.deepEqual(
      shownDomains(DOMAINS, "  la  ").map(({ id }) => id),
      ["customers", "orders"],
    );
    assert.deepEqual(shownDomains([{ ...DOMAINS[0]!, excluded: true }], ""), []);
  });

  it("picks every domain at once, or none once all are, outlines those picked and names them by the button that writes their tests", () => {
    const all = screen({ chosen: new Set(["customers", "orders"]) });
    assert.match(textOf(all), /^.*Ne rien choisir 2 domaines/);
    assert.match(all, /<div class="tile on">/);
    assert.match(textOf(all), /2 domaines choisis sur 2 Clients, Commandes Générer les tests$/);
    assert.doesNotMatch(screen(), /class="tile on"/);
  });

  it("sets the domains a person excluded apart, to take back, and says it when every one is, and why a change was refused", () => {
    const [customers, orders] = DOMAINS as [(typeof DOMAINS)[0], (typeof DOMAINS)[0]];
    const html = screen({ domains: [{ ...customers, excluded: true }, orders] });
    assert.match(
      textOf(html),
      /sur 1 Générer les tests Domaines exclus · Les agents n’y travaillent pas\. Clients La recherche et la fiche d’un client\. Réintégrer$/,
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
    assert.match(textOf(html), /Nom du domaine Nom La cartographie l’a nommé « Commandes »\. Refusé\. Annuler Enregistrer$/);
    assert.match(html, /name="label" value="Ventes"|value="Ventes"/);
    assert.doesNotMatch(textOf(screen({ route: at("#/discovery?panel=rename%3Aorders") })), /La cartographie l’a nommé/);
  });

  it("writes the tests of the domains picked, says the session opens, and why it was refused", () => {
    assert.match(
      screen({ chosen: new Set(["orders"]) }),
      /<input id="domain-orders" type="checkbox" name="domain" checked="" value="orders"\/>.*<button type="submit" class="btn primary">Générer les tests<\/button>/s,
    );
    assert.match(screen({ chosen: new Set(["orders", "customers"]) }), />Générer les tests</);
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
