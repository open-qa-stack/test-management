import assert from "node:assert/strict";
import { createElement } from "react";
import type { ConfigError } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import { configurationAfter, INITIAL_CONFIGURATION, type ConfigurationAction, type ConfigurationState } from "../../src/configuration/configuration-state.ts";
import { ITEM_FORM } from "../../src/configuration/draft-form.tsx";
import { SourceEditor } from "../../src/knowledge/source-editor.tsx";
import { KnowledgeCard } from "../../src/configuration/knowledge-card.tsx";
import { parseRoute } from "../../src/routing/route.ts";
import { DOCUMENT, REVISIONS, VIEW } from "../configuration/configuration-fixture.ts";
import { bears, fieldsNamed } from "../configuration/fields.ts";
import { render, textOf } from "../render.ts";
import { UNCALLED_CONTROLS } from "../configuration/uncalled-controls.ts";

/** What the person does to the source, which a static rendering never calls. */
const CONTROLS = UNCALLED_CONTROLS;

/** The draft after the actions, from the configuration of the fixtures in force. */
const stateAfter = (actions: readonly ConfigurationAction[] = []): ConfigurationState =>
  [{ type: "read", view: VIEW, revisions: REVISIONS } as const, ...actions].reduce(configurationAfter, INITIAL_CONFIGURATION);

/** The editor of the source of a rank, as HTML, at an address. */
const editor = (rank: number, state: ConfigurationState = stateAfter(), removable = false, hash = "#/knowledge/contract"): string =>
  render(createElement(SourceEditor, { state, controls: CONTROLS, rank, route: parseRoute(hash), removable }));

describe("the editor of a source", () => {
  it("shows nothing before the instance told the configuration, nor for a rank it does not hold", () => {
    assert.equal(editor(0, INITIAL_CONFIGURATION), "");
    assert.equal(editor(8), "");
  });

  it("shows the source alone in a form of its own, with nothing to save while nothing changed, and no button that removes it", () => {
    const html = editor(0);
    assert.match(html, new RegExp(`^<form id="${ITEM_FORM}" class="config-form" noValidate="">`));
    assert.match(textOf(html), /^Documentation de l’API Identifiant/);
    assert.match(textOf(html), /Enregistrée$/);
    assert.doesNotMatch(html, /type="submit"/, "nothing to save, no button to save");
    assert.doesNotMatch(html, /data-remove="\/knowledge\/0"/);
    assert.deepEqual(fieldsNamed(html, "/knowledge/1/id"), []);
  });

  it("shows each kind of source with what it is read from, never a secret, and what it is attached to", () => {
    assert.ok(bears(editor(0), "/knowledge/0/url", 'value="http://127.0.0.1:3001/openapi.json"', 'placeholder="https://"'));
    assert.ok(bears(editor(1), "/knowledge/1/path", 'value="specs/openapi.yaml"'));
    const database = editor(2);
    assert.ok(bears(database, "/knowledge/2/connectionStringEnv", 'value="SHOP_DB_URL"', 'aria-describedby="config-knowledge-2-connectionStringEnv-hint"'));
    assert.match(
      textOf(database),
      /Le nom sous lequel la chaîne de connexion est gardée ; tapez-la ci-dessous, elle reste sur l’ordinateur où tourne l’outil\./,
    );
    assert.match(database, /id="secret-SHOP_DB_URL"/);
    const told = stateAfter([
      { type: "secrets", secrets: [{ name: "SHOP_DB_URL", kind: "connection_string", paths: ["/knowledge/2/connectionStringEnv"], source: "environment" }] },
    ]);
    assert.match(textOf(editor(2, told)), /vient de l’environnement de l’outil/, "the editor tells where the value comes from");
    assert.ok(bears(editor(3), "/knowledge/3/path", 'value="specs/orders.md"'));
    const stored = editor(4);
    assert.deepEqual(fieldsNamed(stored, "/knowledge/4/path"), []);
    assert.doesNotMatch(stored, /Ouvrir ses documents/, "the page of the source shows its documents");
    assert.match(textOf(stored), /Ses documents sont gardés par l’instance, et s’y déposent une fois la configuration enregistrée\./);
    const code = editor(5);
    assert.ok(bears(code, "/knowledge/5/commands", 'data-kind="choice"'));
    assert.match(
      textOf(code),
      /Commandes permises aux agents L’historique git \(par défaut\) Aucune : lister, chercher et lire L’historique git Toute commande du shell/,
    );
    const logs = editor(7);
    assert.ok(bears(logs, "/knowledge/7/container", 'value="shop"'));
    assert.match(logs, /<option value="podman" selected="">podman<\/option>/);
    const contract = editor(0);
    assert.match(textOf(contract), /Sert à : Shop, local › backend Modifier Ajouter un rattachement/);
    assert.doesNotMatch(contract, /<dialog/, "no panel is open");
  });

  it("lists the attachments a row each, which opens the panel that changes it, as does the button that adds one", () => {
    const html = editor(0);
    assert.match(
      html,
      /<a class="btn sm" href="#\/knowledge\/contract\?panel=attachment%3A0" aria-label="Modifier Sert à : Shop, local › backend">Modifier<\/a>/,
    );
    assert.match(html, /data-add="\/knowledge\/0\/attachments" data-item="attachment" data-panel="attachment:1"/);
    assert.deepEqual(fieldsNamed(html, "/knowledge/0/attachments/0/application"), [], "the fields of an attachment are in its panel");
  });

  it("changes an attachment in a panel: its application, environment and API, and what removes it and closes the panel", () => {
    const html = editor(0, stateAfter(), false, "#/knowledge/contract?panel=attachment%3A0");
    assert.match(
      html,
      /<dialog class="side-panel" aria-labelledby="source-panel-title"><header class="side-panel-head"><h2 id="source-panel-title">Rattachement 1<\/h2><a class="side-panel-close" href="#\/knowledge\/contract" aria-label="Fermer">/,
    );
    assert.match(
      textOf(html),
      /Rattachement 1 Application Choisir une application Shop Environnement Tous les environnements local API Toutes les API backend Retirer ce rattachement Enregistrée Enregistrée$/,
      "the panel and the page each tell where the change stands",
    );
    assert.match(html, /<option value="backend" selected="">backend<\/option>/);
    assert.match(html, /<option value="shop" selected="">Shop<\/option>/);
    assert.match(html, /<button type="button" class="btn ghost" data-remove="\/knowledge\/0\/attachments\/0" data-panel="">Retirer ce rattachement<\/button>/);
    assert.doesNotMatch(
      editor(0, stateAfter(), false, "#/knowledge/contract?panel=attachment%3A3"),
      /<dialog/,
      "an attachment the draft no longer holds opens no panel",
    );
    assert.doesNotMatch(editor(0, stateAfter(), false, "#/knowledge/contract?panel=account%3A0"), /<dialog/, "a panel the page does not know opens nothing");
  });

  it("shows a source added as it is to fill, which it offers to remove, and keeps a reference that no longer names anything, beside its error", () => {
    const added = stateAfter([
      { type: "add", pointer: "/knowledge", item: { id: "", type: "document", stored: true, attachments: [{ application: "" }] } },
      { type: "edit", pointer: "/knowledge/8/attachments/0/environment", value: "gone" },
      { type: "edit", pointer: "/knowledge/8/attachments/0/api", value: "old" },
    ]);
    const errors: ConfigError[] = [
      { kind: "reference", path: "/knowledge/8/attachments/0/application", rule: "slug", message: "Expected a slug." },
      { kind: "structure", path: "/knowledge/8", rule: "document-source", message: 'Declare exactly one of "path" or "stored".' },
    ];
    const html = editor(8, { ...added, errors, tried: true }, true, "#/knowledge?add=source&panel=attachment%3A0");
    const text = textOf(html);
    assert.match(text, /Sert à : une application à choisir, gone › old À corriger Modifier/, "the row of a wrong attachment says it");
    assert.match(text, /^2 erreurs à corriger avant d’enregistrer/);
    assert.match(text, /Documents déposés Retirer Soit un chemin, soit des documents déposés : exactement l’un des deux\./);
    assert.match(html, /aria-label="Retirer la source Source 9" data-remove="\/knowledge\/8"/);
    assert.match(html, /<select id="config-knowledge-8-attachments-0-application"[^>]*aria-invalid="true"/);
    assert.match(html, /<option value="" selected="">Choisir une application<\/option>/);
    assert.match(html, /<option value="gone" selected="">gone<\/option>/);
    assert.match(html, /<option value="old" selected="">old<\/option>/);
    assert.doesNotMatch(html, /href="#\/knowledge\/"/);
    assert.match(text, /Modifications non enregistrées Annuler les modifications Enregistrer$/);
    assert.match(textOf(editor(8, configurationAfter(added, { type: "saving" }), true)), /Enregistrement… Annuler/);
  });

  it("says what the source is for: given applications, each narrowed if need be, or the whole project, which has no attachment to add", () => {
    const attached = editor(0);
    assert.match(attached, /<option value="applications" selected="">Des applications précises<\/option>/);
    assert.ok(bears(attached, "/knowledge/0/attachments", "select", 'data-kind="reach"'));
    assert.match(
      textOf(attached),
      /Portée Pour Tout le projet Des applications précises Elle décrit ces applications, .* Une session qui teste une autre application peut la lire, avec un avertissement\. Sert à : Shop, local › backend/,
    );
    const wide = editor(0, stateAfter([{ type: "edit", pointer: "/knowledge/0/attachments", value: undefined }]));
    assert.match(wide, /<option value="project" selected="">Tout le projet<\/option>/);
    assert.match(
      textOf(wide),
      /Les sessions la lisent quelle que soit l’application qu’elles testent\. Enregistrée|Les sessions la lisent quelle que soit l’application qu’elles testent\. Modifications non enregistrées/,
    );
    assert.doesNotMatch(wide, /Rattachement 1|data-item="attachment"/);
  });

  it("says in words what each attachment serves: the application, then where it narrows to, or every environment", () => {
    const attachments = [{ application: "shop" }, { application: "gone" }];
    const named = stateAfter([{ type: "edit", pointer: "/knowledge/0/attachments", value: attachments }]);
    assert.match(
      textOf(editor(0, named)),
      /Sert à : Shop, tous les environnements Modifier Sert à : une application à choisir, tous les environnements Modifier/,
    );
    const unnamed = configurationAfter(named, { type: "edit", pointer: "/applications/0/name", value: "" });
    assert.match(textOf(editor(0, unnamed)), /Sert à : shop, tous les environnements/);
  });

  it("hands the card the latest test of the source, and says a change was saved or why it was refused", () => {
    const source = DOCUMENT.knowledge[1]!;
    assert.match(
      textOf(
        editor(
          1,
          stateAfter([
            { type: "sourceChecked", rank: 1, source, check: { state: "ok", items: 4 } },
            { type: "sourceChecking", rank: 1, source },
          ]),
        ),
      ),
      /Test en cours…/,
    );
    assert.match(editor(1, configurationAfter(stateAfter(), { type: "saved", view: VIEW })), /<p class="config-note ok" role="status">Révision 2 enregistrée/);
    const refused = stateAfter([{ type: "refused", code: "stale_revision", text: "La configuration a changé.", errors: [] }]);
    assert.match(editor(1, refused), /<p class="config-note ko" role="alert">La configuration a changé\.<\/p>/);
  });
});

describe("the card of a source of documents the instance keeps", () => {
  it("leads to its documents, where the screen does not show them already", () => {
    const html = render(
      createElement(KnowledgeCard, { source: DOCUMENT.knowledge[4]!, rank: 4, applications: DOCUMENT.applications, onCheck: CONTROLS.checkSource }),
    );
    assert.match(html, /<a class="btn sm" href="#\/knowledge\/manuals">Ouvrir ses documents<\/a>/);
  });

  it("shows the fields of its attachments open, where no panel changes them", () => {
    const html = render(
      createElement(KnowledgeCard, { source: DOCUMENT.knowledge[0]!, rank: 0, applications: DOCUMENT.applications, onCheck: CONTROLS.checkSource }),
    );
    assert.match(textOf(html), /Sert à : Shop, local › backend Retirer Application Choisir une application Shop/);
    assert.match(html, /aria-label="Retirer le rattachement 1 de contract" data-remove="\/knowledge\/0\/attachments\/0"/);
    assert.match(html, /data-add="\/knowledge\/0\/attachments" data-item="attachment">/);
  });
});
