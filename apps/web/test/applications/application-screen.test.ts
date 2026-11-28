import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { ConfigError } from "@open-qa-stack/domain/sessions";
import { ApplicationScreen, type ApplicationControls } from "../../src/applications/application-screen.tsx";
import { NEW_ITEMS } from "../../src/configuration/configuration-edit.ts";
import { configurationAfter, INITIAL_CONFIGURATION, type ConfigurationAction, type ConfigurationState } from "../../src/configuration/configuration-state.ts";
import { parseRoute } from "../../src/routing/route.ts";
import { linksOf, render, textOf } from "../render.ts";
import { DOCUMENT, REVISIONS, VIEW } from "../configuration/configuration-fixture.ts";
import { bears } from "../configuration/fields.ts";
import { UNCALLED_CONTROLS } from "../configuration/uncalled-controls.ts";

/** What the person does on the page, which a static rendering never calls. */
const CONTROLS: ApplicationControls = {
  drop: () => assert.fail("no application is removed"),
  edit: UNCALLED_CONTROLS,
};

/** The draft after the actions, from the configuration of the fixtures in force. */
const stateAfter = (actions: readonly ConfigurationAction[] = []): ConfigurationState =>
  [{ type: "read", view: VIEW, revisions: REVISIONS } as const, ...actions].reduce(configurationAfter, INITIAL_CONFIGURATION);

/** The page of an address in a state, as HTML. */
const page = (hash: string, state: ConfigurationState = stateAfter()): string =>
  render(createElement(ApplicationScreen, { project: "shop-tests", route: parseRoute(hash), state, controls: CONTROLS }));

describe("the page of an application", () => {
  it("says it reads the configuration until the instance told it, and leads back to the configuration", () => {
    assert.match(
      textOf(page("#/applications/shop", INITIAL_CONFIGURATION)),
      /^Applications shop-tests \/ Applications \/ shop shop Lecture de la configuration Elle apparaît dès que l’instance a répondu\. Revenir aux applications$/,
    );
    assert.match(
      textOf(page("#/applications?add=application", { ...INITIAL_CONFIGURATION, unread: "Down." })),
      /Nouvelle application Lecture de la configuration Down\./,
    );
  });

  it("says the configuration declares no application of that name", () => {
    const html = page("#/applications/gone");
    assert.match(
      textOf(html),
      /Aucune application de ce nom La configuration en vigueur n’en déclare aucune : elle a pu être renommée ou retirée\. Revenir aux applications$/,
    );
    assert.deepEqual(linksOf(html).at(-1), "#/applications");
  });

  it("shows what the application is, then its test accounts and its environments a row each, with nothing to save while nothing changed, and no button that removes it", () => {
    const html = page("#/applications/shop");
    const text = textOf(html);
    assert.match(text, /^Applications shop-tests \/ Applications \/ Shop Shop Retirer l’application Nom .* Avancé Identifiant Minuscules/);
    assert.match(
      text,
      /Comptes de test clerk Modifier Ajouter un compte Environnements local http:\/\/127\.0\.0\.1:3000 · 1 API Modifier Ajouter un environnement Enregistrée$/,
    );
    assert.doesNotMatch(html, /data-remove="\/applications\/0"/);
    assert.doesNotMatch(html, /<dialog/, "no panel is open");
    assert.match(html, /<a class="btn ghost" href="#\/applications\/shop\?drop=application">Retirer l’application<\/a>/);
    assert.match(html, /<label for="config-applications-0-id">Identifiant<\/label>/);
    assert.ok(bears(html, "/applications/0/id", "input", 'id="config-applications-0-id"', 'data-kind="text"', 'class="mono"', 'value="shop"'));
    assert.match(html, /<option value="web">Interface web<\/option><option value="api">API<\/option><option value="web-and-api" selected="">/);
    assert.ok(bears(html, "/applications/0/type", "select", 'data-kind="choice"', 'aria-invalid="false"'));
    assert.match(html, /<a class="btn sm" href="#\/applications\/shop\?panel=account%3A0" aria-label="Modifier clerk">Modifier<\/a>/);
    assert.match(html, /<a class="btn sm" href="#\/applications\/shop\?panel=environment%3A0" aria-label="Modifier local">Modifier<\/a>/);
    assert.match(html, /data-add="\/applications\/0\/authentication\/accounts" data-item="account" data-panel="account:1"/);
    assert.match(html, /data-add="\/applications\/0\/environments" data-item="environment" data-panel="environment:1"/);
  });

  it("changes a test account in a panel: its name, the values of its variables beside them, the variables folded, and what removes it and closes the panel", () => {
    const html = page("#/applications/shop?panel=account%3A0");
    assert.match(
      html,
      /<dialog class="side-panel" aria-labelledby="application-panel-title"><header class="side-panel-head"><h2 id="application-panel-title">Compte clerk<\/h2><a class="side-panel-close" href="#\/applications\/shop" aria-label="Fermer">/,
    );
    for (const variable of ["SHOP_USER", "SHOP_PASSWORD"]) assert.match(html, new RegExp(`id="secret-${variable}"`));
    assert.ok(bears(html, "/applications/0/authentication/accounts/0/passwordEnv", 'value="SHOP_PASSWORD"', 'class="mono"'));
    assert.match(
      html,
      /<button type="button" class="btn ghost" data-remove="\/applications\/0\/authentication\/accounts\/0" data-panel="">Retirer ce compte<\/button>/,
    );
    assert.match(textOf(html), /Retirer ce compte Enregistrée Enregistrée$/, "the panel and the page each tell where the change stands");
    assert.doesNotMatch(page("#/applications/shop?panel=account%3A3"), /<dialog/, "an account the draft no longer holds opens no panel");
  });

  it("changes an environment in a panel: its fields, its APIs each with what removes it, and what removes the environment and closes the panel", () => {
    const html = page("#/applications/shop?panel=environment%3A0");
    assert.match(textOf(html), /Environnement local Nom Comme les sessions le nomment/);
    assert.ok(bears(html, "/applications/0/environments/0/apis/0/baseUrl", 'value="http://127.0.0.1:3001"'));
    assert.match(html, /data-add="\/applications\/0\/environments\/0\/apis" data-item="api"/);
    assert.match(html, /aria-label="Retirer l’API backend de l’environnement local" data-remove="\/applications\/0\/environments\/0\/apis\/0"/);
    assert.match(html, /<option value="read-write" selected="">/);
    assert.match(html, /data-remove="\/applications\/0\/environments\/0" data-panel="">Retirer cet environnement<\/button>/);
    assert.doesNotMatch(page("#/applications/shop?panel=other%3A0"), /<dialog/, "a panel the page does not know opens nothing");
  });

  it("criterion 3 — offers to test each address of an environment beside its field, and tells the wait, then what the test found, while the field holds the address tested", () => {
    const at = "/applications/0/environments/0";
    const panel = "#/applications/shop?panel=environment%3A0";
    const html = page(panel);
    assert.match(html, new RegExp(`<button type="button" class="btn sm" data-pointer="${at}/uiUrl" aria-label="Tester http://127.0.0.1:3000">Tester</button>`));
    assert.match(html, new RegExp(`data-pointer="${at}/apis/0/baseUrl" aria-label="Tester http://127.0.0.1:3001">Tester</button>`));
    assert.doesNotMatch(html, /role="status">(Test en cours|Répond)/);
    const tested = (test: object, pointer = `${at}/uiUrl`) =>
      page(panel, { ...stateAfter(), addressChecks: { [pointer]: { address: "http://127.0.0.1:3000", ...test } } });
    assert.match(
      tested({}),
      /disabled="" aria-label="Tester http:\/\/127\.0\.0\.1:3000">Tester<\/button><p class="small muted" role="status">Test en cours…<\/p>/,
    );
    const url = "http://127.0.0.1:3000";
    for (const [check, text] of [
      [{ state: "answers", url, status: 500 }, '<p class="config-note ok" role="status">Répond (500).</p>'],
      [{ state: "malformed", url }, "Ce n’est pas une adresse http ou https : vérifiez son écriture."],
      [{ state: "unknown-host", url }, "Aucune machine ne porte ce nom : vérifiez-le, c’est souvent une faute de frappe."],
      [{ state: "refused", url }, "La connexion est refusée : rien n’écoute sur ce port. Vérifiez le port, et que l’application tourne."],
      [{ state: "timeout", url }, "Pas de réponse en dix secondes : vérifiez que l’application tourne et qu’elle est joignable d’ici."],
      [{ state: "unreachable", url }, "Injoignable : vérifiez l’adresse et le réseau."],
      [{ state: "unreachable", url, code: "ECONNRESET" }, "Injoignable (ECONNRESET) : vérifiez l’adresse et le réseau."],
    ] as const)
      assert.ok(tested({ check }).includes(text), text);
    assert.match(tested({ failure: "Down." }), /<p class="config-note ko" role="status">Le test n’a pas pu se faire : Down\.<\/p>/);
    const changed = page(panel, {
      ...stateAfter(),
      addressChecks: { [`${at}/uiUrl`]: { address: "http://old.test/", check: { state: "answers", url, status: 200 } } },
    });
    assert.doesNotMatch(changed, /Répond/, "a test of an address since changed is not shown");
  });

  it("warns that Open QA Stack is not meant for production, and folds under « Avancé » what the environment allows, each allowed by default", () => {
    const panel = "#/applications/shop?panel=environment%3A0";
    const html = page(panel);
    assert.match(html, /<p class="config-note warn">Open QA Stack n’est pas fait pour la production/);
    assert.match(
      html,
      /<input id="config-applications-0-environments-0-allow-design" type="checkbox" data-kind="flag" name="\/applications\/0\/environments\/0\/allow\/design" checked=""\/>/,
    );
    assert.match(html, /name="\/applications\/0\/environments\/0\/allow\/run" checked=""\/><span>Les tests peuvent s’exécuter sur cet environnement/);
    const document = {
      ...DOCUMENT,
      applications: [{ ...DOCUMENT.applications[0]!, environments: [{ ...DOCUMENT.applications[0]!.environments[0]!, allow: { run: false } }] }],
    };
    const view = { ...VIEW, revision: { ...VIEW.revision!, document } };
    const forbidding = page(panel, configurationAfter(INITIAL_CONFIGURATION, { type: "read", view, revisions: REVISIONS }));
    assert.match(forbidding, /name="\/applications\/0\/environments\/0\/allow\/run"\/>/, "a run forbidden is unchecked");
  });

  it("offers no test of an address an environment does not give", () => {
    const document = {
      ...DOCUMENT,
      applications: [{ ...DOCUMENT.applications[0]!, type: "api" as const, environments: [{ name: "local", apis: [{ name: "backend", baseUrl: "" }] }] }],
    };
    const view = { ...VIEW, revision: { ...VIEW.revision!, document } };
    const bare = configurationAfter(INITIAL_CONFIGURATION, { type: "read", view, revisions: REVISIONS });
    assert.match(
      page("#/applications/shop?panel=environment%3A0", bare),
      /data-pointer="\/applications\/0\/environments\/0\/uiUrl" disabled="" aria-label="Tester ">/,
    );
    assert.match(
      page("#/applications/shop?panel=environment%3A0", bare),
      /data-pointer="\/applications\/0\/environments\/0\/apis\/0\/baseUrl" disabled="" aria-label="Tester ">/,
      "an API added has no address yet",
    );
  });

  it("marks a part that holds an error to correct, says when there is no test account, and names a part without a name by its rank", () => {
    const wrong = configurationAfter(stateAfter(), {
      type: "checked",
      draft: stateAfter().draft!,
      errors: [{ kind: "structure", path: "/applications/0/environments/0/uiUrl", rule: "format", message: "…" }],
    });
    assert.match(textOf(page("#/applications/shop", { ...wrong, tried: true })), /local http:\/\/127\.0\.0\.1:3000 · 1 API À corriger Modifier/);
    const document = {
      ...DOCUMENT,
      applications: [{ ...DOCUMENT.applications[0]!, authentication: { method: "none" as const }, environments: [{ name: "", uiUrl: "" }] }],
    };
    const view = { ...VIEW, revision: { ...VIEW.revision!, document } };
    const bare = configurationAfter(INITIAL_CONFIGURATION, { type: "read", view, revisions: REVISIONS });
    assert.match(
      textOf(page("#/applications/shop", bare)),
      /Comptes de test Aucun compte de test pour l’instant\. Ajouter un compte Environnements Environnement 1 aucune API Modifier/,
    );
    const unnamed = {
      ...DOCUMENT,
      applications: [
        { ...DOCUMENT.applications[0]!, authentication: { method: "form" as const, accounts: [{ name: "", usernameEnv: "U", passwordEnv: "P" }] } },
      ],
    };
    const named = configurationAfter(INITIAL_CONFIGURATION, {
      type: "read",
      view: { ...VIEW, revision: { ...VIEW.revision!, document: unnamed } },
      revisions: REVISIONS,
    });
    assert.match(textOf(page("#/applications/shop", named)), /Comptes de test Compte 1 Modifier Ajouter un compte/);
  });

  it("names an application in force without a name by its rank", () => {
    const document = { ...DOCUMENT, applications: [{ ...DOCUMENT.applications[0]!, name: "" }] };
    const view = { ...VIEW, revision: { ...VIEW.revision!, document } };
    const unnamed = configurationAfter(INITIAL_CONFIGURATION, { type: "read", view, revisions: REVISIONS });
    assert.match(textOf(page("#/applications/shop", unnamed)), /^Applications shop-tests \/ Applications \/ Application 1 Application 1 Retirer l’application/);
  });

  it("folds the identifier and the variables under « Avancé », which opens by itself on an error of one of them", () => {
    assert.match(
      page("#/applications/shop"),
      /<details class="config-advanced"><summary>Avancé<\/summary><div class="config-fields"><div class="config-field"><label for="config-applications-0-id">/,
    );
    const wrong = configurationAfter(stateAfter(), {
      type: "checked",
      draft: stateAfter().draft!,
      errors: [{ kind: "structure", path: "/applications/0/id", rule: "slug", message: "…" }],
    });
    assert.match(
      page("#/applications/shop", { ...wrong, tried: true }),
      /<details class="config-advanced" open=""><summary>Avancé<\/summary><div class="config-fields"><div class="config-field"><label for="config-applications-0-id">/,
    );
  });

  it("asks before it removes the application, and offers to cancel", () => {
    const html = page("#/applications/shop?drop=application");
    assert.match(
      textOf(html),
      /Retirer l’application Shop \? Les prochaines sessions ne la testent plus\. .* Les sources qui lui sont rattachées doivent d’abord en être détachées\. Annuler Retirer l’application Nom/,
    );
    assert.match(html, /<button type="button" class="btn danger" data-rank="0">Retirer l’application<\/button>/);
    assert.match(page("#/applications/shop?drop=application", configurationAfter(stateAfter(), { type: "saving" })), /data-rank="0" disabled="">/);
  });

  it("shows the application being added under the title of the page, with no button that removes it, beside the errors of the draft", () => {
    assert.doesNotMatch(page("#/applications?add=application"), /<form/, "nothing until the page added it");
    const added = stateAfter([{ type: "add", pointer: "/applications", item: NEW_ITEMS.application }]);
    const errors: ConfigError[] = [{ kind: "structure", path: "/applications/1/environments", rule: "too-few-items", message: "Too few items." }];
    const html = page("#/applications?add=application", { ...added, errors, tried: true });
    const text = textOf(html);
    assert.match(text, /^Applications shop-tests \/ Applications \/ Nouvelle application Nouvelle application 1 erreur à corriger avant d’enregistrer/);
    assert.match(text, /avant d’enregistrer .*Nom /);
    assert.doesNotMatch(html, /data-remove="\/applications\/1"/);
    assert.match(text, /Environnements Environnement 1 aucune API Modifier Il en faut au moins un\. Ajouter un environnement/);
    assert.match(html, /href="#\/applications\?add=application&amp;panel=environment%3A0"/);
    assert.match(text, /Modifications non enregistrées Annuler les modifications Enregistrer$/);
  });
});
