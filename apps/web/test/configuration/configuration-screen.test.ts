import assert from "node:assert/strict";
import { createElement } from "react";
import type { ConfigError, OqasConfig } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import { ConfigurationScreen, FORM_ID, type ConfigurationControls } from "../../src/configuration/configuration-screen.tsx";
import { configurationAfter, INITIAL_CONFIGURATION, type ConfigurationAction, type ConfigurationState } from "../../src/configuration/configuration-state.ts";
import { render, textOf } from "../render.ts";
import { BARE, DOCUMENT, REVISIONS, VIEW } from "./configuration-fixture.ts";

/** What the person does on the screen, which a static rendering never calls. */
const CONTROLS: ConfigurationControls = {
  change: () => assert.fail("nothing is changed"),
  click: () => assert.fail("nothing is pressed"),
  save: () => assert.fail("nothing is saved"),
  discard: () => assert.fail("nothing is dropped"),
  keepFile: () => assert.fail("no file is taken"),
  keepChange: () => assert.fail("no change is kept"),
};

/** The state after the actions, from the state once the instance told the configuration of the fixtures. */
function stateAfter(actions: readonly ConfigurationAction[], document: OqasConfig = DOCUMENT): ConfigurationState {
  const view = { ...VIEW, revision: { ...VIEW.revision!, document } };
  return [{ type: "read", view, revisions: REVISIONS } as const, ...actions].reduce(configurationAfter, INITIAL_CONFIGURATION);
}

/**
 * The tags of the fields of a name in a piece of HTML.
 *
 * @param html - The HTML.
 * @param name - The name of the fields, their JSON Pointer.
 * @returns Each tag, as a set of its attributes written `name="value"`, and the kind of its element.
 */
function fieldsNamed(html: string, name: string): string[][] {
  return [...html.matchAll(/<(input|select)\b([^>]*)>/g)]
    .filter(([, , attributes]) => attributes!.includes(` name="${name}"`))
    .map(([, kind, attributes]) => [kind!, ...[...attributes!.matchAll(/([\w-]+)="([^"]*)"/g)].map(([attribute]) => attribute)]);
}

/** Tells whether a field of a name bears the attributes given, whatever their order. */
function bears(html: string, name: string, ...attributes: string[]): boolean {
  return fieldsNamed(html, name).some((field) => attributes.every((attribute) => field.includes(attribute)));
}

/** The screen in a state, as HTML. */
const screen = (state: ConfigurationState): string => render(createElement(ConfigurationScreen, { project: "shop-tests", state, controls: CONTROLS }));

describe("the screen of the configuration", () => {
  it("says it reads the configuration until the instance told it, and why it could not", () => {
    assert.equal(
      textOf(screen(INITIAL_CONFIGURATION)),
      "shop-tests / Configuration Configuration Lecture de la configuration Elle apparaît dès que l’instance a répondu.",
    );
    assert.match(textOf(screen({ ...INITIAL_CONFIGURATION, unread: "L’instance ne répond pas." })), /Lecture de la configuration L’instance ne répond pas\.$/);
  });

  it("says the instance has no configuration yet, and offers to take the file when there is one", () => {
    const none = [{ type: "read", view: { file: "changed" }, revisions: [] } as const].reduce(configurationAfter, INITIAL_CONFIGURATION);
    const html = screen(none);
    assert.match(
      textOf(html),
      /oqas\.json a changé depuis la révision en vigueur .* Prendre oqas\.json L’instance n’a pas encore de configuration Écrivez oqas\.json/,
    );
  });

  it("shows the revision in force in a form of its own, its sections, and the history, with nothing to save while nothing changed", () => {
    const html = screen(stateAfter([]));
    const text = textOf(html);
    assert.match(html, new RegExp(`<form id="${FORM_ID}" class="config-form" noValidate="">`));
    assert.match(text, /Révision 2 en vigueur Annuler les modifications Enregistrer/);
    assert.match(html, /<button type="submit" form="configuration-form" class="btn primary" disabled="">Enregistrer<\/button>/);
    for (const heading of ["Applications et environnements", "Agents", "Dépôt de tests", "Historique"])
      assert.match(html, new RegExp(`<h2 id="[^"]+">${heading}</h2>`));
    assert.match(text, /Révision 2 Console · .* en vigueur Révision 1 Fichier oqas\.json · /);
    assert.match(text, /Aucun secret n’est gardé/);
    assert.match(html, /<summary>Voir la configuration en JSON<\/summary><pre class="mono">\{\n {2}&quot;formatVersion&quot;: 1,/);
  });

  it("gives every field a label, its value from the draft, and the defaults where the draft leaves a key out", () => {
    const html = screen(stateAfter([]));
    assert.match(html, /<label for="config-applications-0-id">Identifiant<\/label>/);
    assert.ok(bears(html, "/applications/0/id", "input", 'id="config-applications-0-id"', 'data-kind="text"', 'class="mono"', 'value="shop"'));
    assert.match(html, /<option value="web">Interface web<\/option><option value="api">API<\/option><option value="web-and-api" selected="">/);
    assert.ok(bears(html, "/applications/0/type", "select", 'data-kind="choice"', 'aria-invalid="false"'));
    assert.ok(bears(html, "/applications/0/authentication/accounts/0/passwordEnv", 'value="SHOP_PASSWORD"', 'class="mono"'));
    assert.ok(bears(html, "/applications/0/environments/0/apis/0/baseUrl", 'value="http://127.0.0.1:3001"'));
    assert.match(html, /<option value="read-write" selected="">/);
    assert.ok(
      bears(
        html,
        "/model/requestTimeoutSeconds",
        'type="number"',
        'data-kind="number"',
        'value=""',
        'min="1"',
        'step="1"',
        'inputMode="numeric"',
        'placeholder="120"',
      ),
    );
    assert.ok(bears(html, "/model/capabilities", 'data-kind="member"', 'checked=""', 'data-member="vision"', 'data-defaults=""'));
    assert.ok(bears(html, "/autonomy/level", "select", 'data-kind="level"'));
    assert.ok(bears(html, "/autonomy/task/maxMinutes", 'value="10"'));
    assert.ok(bears(html, "/autonomy/guardrailMinutes", 'value="60"', 'placeholder="aucun"'));
    assert.ok(bears(html, "/design/levels", 'data-member="smoke"', 'checked=""', 'data-defaults="smoke,functional,business"'));
    assert.ok(!bears(html, "/design/levels", 'data-member="functional"', 'checked=""'));
    assert.ok(bears(html, "/repository/appsDir", 'value="tests"', 'placeholder="apps"'));
    assert.ok(bears(html, "/repository/blocksDir", 'value=""', 'placeholder="blocs"'));
    assert.match(html, /data-add="\/applications\/0\/environments\/0\/apis" data-item="api"/);
    assert.match(html, /aria-label="Retirer l’application Shop" data-remove="\/applications\/0"/);
    assert.match(textOf(html), /Environnement local Retirer Nom Comme les sessions le nomment/);
    assert.match(html, /aria-label="Retirer l’environnement local de Shop" data-remove="\/applications\/0\/environments\/0"/);
    assert.match(html, /aria-label="Retirer l’API backend de l’environnement local" data-remove="\/applications\/0\/environments\/0\/apis\/0"/);
    assert.match(html, /aria-label="Retirer le compte clerk de Shop" data-remove="\/applications\/0\/authentication\/accounts\/0"/);
    assert.ok(bears(html, "/applications/0/id", 'aria-describedby="config-applications-0-id-hint"'));
    assert.match(html, /name="\/applications\/0\/id" value="shop"\/><span id="config-applications-0-id-hint" class="field-hint">/);
  });

  it("names an application and an environment without a name by their rank, and lays out the defaults of a bare configuration", () => {
    const html = screen(stateAfter([], BARE));
    const text = textOf(html);
    assert.match(text, /Application 1 · sans identifiant/);
    assert.match(text, /Environnement 1 Environnement 1 Retirer Nom/);
    assert.match(html, /aria-label="Retirer l’environnement 1 de Application 1" data-remove="\/applications\/0\/environments\/0"/);
    assert.ok(bears(html, "/autonomy/guardrailMinutes", 'value=""', 'placeholder="120"'));
    assert.doesNotMatch(html, /\/autonomy\/task/);
    for (const level of ["smoke", "functional", "business"]) assert.ok(bears(html, "/design/levels", `data-member="${level}"`, 'checked=""'), level);
    assert.match(text, /Aucune source de connaissance/);
  });

  it("shows the knowledge sources read only, where each is read from, and never a secret", () => {
    const text = textOf(screen(stateAfter([])));
    assert.match(text, /Connaissances · en lecture seule bientôt modifiables Leur édition dans la console arrive dans un prochain lot/);
    for (const source of [
      "contract Contrat OpenAPI · http://127.0.0.1:3001/openapi.json shop › local › backend",
      "local-contract Contrat OpenAPI · specs/openapi.yaml shop",
      "orders Base PostgreSQL · variable SHOP_DB_URL shop",
      "specs Document · specs/orders.md shop",
      "manuals Document · déposés sur l’instance shop",
      "code Code source · ../shop shop",
      "server-log Journaux · logs/server.log shop",
      "container-log Journaux · conteneur shop shop",
    ])
      assert.ok(text.includes(source), source);
  });

  it("says a change is not saved, and lets the person save it or drop it", () => {
    const html = screen(stateAfter([{ type: "edit", pointer: "/model/model", value: "other" }]));
    assert.match(textOf(html), /Modifications non enregistrées Annuler les modifications Enregistrer/);
    assert.match(html, /<button type="submit" form="configuration-form" class="btn primary">Enregistrer<\/button>/);
    assert.match(textOf(screen(stateAfter([{ type: "edit", pointer: "/model/model", value: "other" }, { type: "saving" }]))), /Enregistrement…/);
  });

  it("shows each error the instance found beside its field, and every one of them, counted, at the head of the form", () => {
    const errors: ConfigError[] = [
      { kind: "structure", path: "/model/apiKeyEnv", rule: "env-var-name", message: "Expected…" },
      { kind: "structure", path: "/applications/0/environments", rule: "too-few-items", message: "Too few items." },
      { kind: "structure", path: "", rule: "json", message: "The file is not valid JSON." },
    ];
    const state = stateAfter([{ type: "edit", pointer: "/model/apiKeyEnv", value: "bad name" }]);
    const html = screen(configurationAfter(state, { type: "checked", draft: state.draft!, errors }));
    assert.match(
      textOf(html),
      /3 erreurs à corriger avant d’enregistrer \/model\/apiKeyEnv Nom de variable d’environnement attendu .* \/applications\/0\/environments Il en faut au moins un\. \/ Le fichier n’est pas du JSON valide\./,
    );
    assert.ok(bears(html, "/model/apiKeyEnv", 'aria-invalid="true"', 'aria-describedby="config-model-apiKeyEnv-hint config-model-apiKeyEnv-errors"'));
    assert.match(html, /<span id="config-model-apiKeyEnv-errors" class="field-error">Nom de variable/);
    assert.match(html, /<p class="field-error" role="note">Il en faut au moins un\.<\/p>/);
    const one = configurationAfter(state, { type: "checked", draft: state.draft!, errors: errors.slice(0, 1) });
    assert.match(textOf(screen(one)), /1 erreur à corriger avant d’enregistrer/);
    const choice = configurationAfter(state, {
      type: "checked",
      draft: state.draft!,
      errors: [{ kind: "structure", path: "/model/provider", rule: "unknown-variant", message: "…" }],
    });
    assert.ok(bears(screen(choice), "/model/provider", "select", 'aria-invalid="true"', 'aria-describedby="config-model-provider-errors"'));
  });

  it("says when the file changed, or cannot be read, and that a change was saved", () => {
    const changed = configurationAfter(stateAfter([]), { type: "read", view: { ...VIEW, file: "changed" }, revisions: REVISIONS });
    assert.match(
      textOf(screen(changed)),
      /oqas\.json a changé depuis la révision en vigueur Il sera pris au démarrage de la prochaine session, ou maintenant\. Prendre oqas\.json/,
    );
    const missing = configurationAfter(stateAfter([]), { type: "read", view: { ...VIEW, file: "missing" }, revisions: REVISIONS });
    assert.match(textOf(screen(missing)), /oqas\.json est introuvable dans le dépôt de tests : le prochain enregistrement l’écrira\./);
    const saved = configurationAfter(stateAfter([]), { type: "saved", view: VIEW });
    assert.match(
      screen(saved),
      /<p class="config-note ok" role="status">Révision 2 enregistrée : oqas\.json est réécrit, et la prochaine session la lit\.<\/p>/,
    );
  });

  it("leaves the person the two ways out when the file and the console both changed, and says why any other change was refused", () => {
    const conflict = stateAfter([
      { type: "edit", pointer: "/model/model", value: "other" },
      { type: "refused", code: "configuration_conflict", text: "Conflit.", errors: [] },
    ]);
    const html = screen(conflict);
    assert.match(html, /<section class="config-note warn" role="alert"><b>oqas\.json a changé depuis la dernière synchronisation<\/b>/);
    assert.match(textOf(html), /Rien n’est fusionné : choisissez ce qui est gardé\. Garder le fichier Garder mes modifications/);
    const stale = stateAfter([{ type: "refused", code: "stale_revision", text: "La configuration a changé.", errors: [] }]);
    assert.match(screen(stale), /<p class="config-note ko" role="alert">La configuration a changé\.<\/p>/);
  });
});
