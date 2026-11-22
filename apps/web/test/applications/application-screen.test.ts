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

/** What the person does on the page, which a static rendering never calls. */
const CONTROLS: ApplicationControls = {
  drop: () => assert.fail("no application is removed"),
  edit: {
    change: () => assert.fail("nothing is changed"),
    click: () => assert.fail("nothing is pressed"),
    save: () => assert.fail("nothing is saved"),
    discard: () => assert.fail("nothing is dropped"),
    takeFile: () => assert.fail("no file is taken"),
    writeFile: () => assert.fail("no file is written"),
    testModel: () => assert.fail("no connection is tested"),
    checkSource: () => assert.fail("no source is tested"),
    setUp: () => assert.fail("nothing is set up"),
  },
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
      /^shop-tests \/ Applications \/ shop shop Lecture de la configuration Elle apparaît dès que l’instance a répondu\. Revenir aux applications$/,
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

  it("shows the application alone, every field with its label and its value, with nothing to save while nothing changed, and no button that removes it", () => {
    const html = page("#/applications/shop");
    assert.match(textOf(html), /^shop-tests \/ Applications \/ Shop Shop Retirer l’application Shop · shop Identifiant/);
    assert.match(textOf(html), /Enregistrée Annuler les modifications Enregistrer$/);
    assert.doesNotMatch(html, /data-remove="\/applications\/0"/);
    assert.match(html, /<a class="btn ghost" href="#\/applications\/shop\?drop=application">Retirer l’application<\/a>/);
    assert.match(html, /<label for="config-applications-0-id">Identifiant<\/label>/);
    assert.ok(bears(html, "/applications/0/id", "input", 'id="config-applications-0-id"', 'data-kind="text"', 'class="mono"', 'value="shop"'));
    assert.match(html, /<option value="web">Interface web<\/option><option value="api">API<\/option><option value="web-and-api" selected="">/);
    assert.ok(bears(html, "/applications/0/type", "select", 'data-kind="choice"', 'aria-invalid="false"'));
    assert.ok(bears(html, "/applications/0/authentication/accounts/0/passwordEnv", 'value="SHOP_PASSWORD"', 'class="mono"'));
    assert.ok(bears(html, "/applications/0/environments/0/apis/0/baseUrl", 'value="http://127.0.0.1:3001"'));
    assert.match(textOf(html), /Environnement local Retirer Nom Comme les sessions le nomment/);
    assert.ok(bears(html, "/applications/0/id", 'aria-describedby="config-applications-0-id-hint"'));
    assert.match(html, /name="\/applications\/0\/id" value="shop"\/><span id="config-applications-0-id-hint" class="field-hint">/);
    assert.match(html, /data-add="\/applications\/0\/environments\/0\/apis" data-item="api"/);
    assert.match(html, /aria-label="Retirer l’environnement local de Shop" data-remove="\/applications\/0\/environments\/0"/);
    assert.match(html, /aria-label="Retirer l’API backend de l’environnement local" data-remove="\/applications\/0\/environments\/0\/apis\/0"/);
    assert.match(html, /aria-label="Retirer le compte clerk de Shop" data-remove="\/applications\/0\/authentication\/accounts\/0"/);
    assert.match(html, /<option value="read-write" selected="">/);
  });

  it("names an application in force without a name by its rank", () => {
    const document = { ...DOCUMENT, applications: [{ ...DOCUMENT.applications[0]!, name: "" }] };
    const view = { ...VIEW, revision: { ...VIEW.revision!, document } };
    const unnamed = configurationAfter(INITIAL_CONFIGURATION, { type: "read", view, revisions: REVISIONS });
    assert.match(textOf(page("#/applications/shop", unnamed)), /^shop-tests \/ Applications \/ Application 1 Application 1 Retirer l’application/);
  });

  it("asks for the values of the variables of the test accounts beside them", () => {
    const html = page("#/applications/shop");
    for (const variable of ["SHOP_USER", "SHOP_PASSWORD"]) assert.match(html, new RegExp(`id="secret-${variable}"`));
  });

  it("asks before it removes the application, and offers to cancel", () => {
    const html = page("#/applications/shop?drop=application");
    assert.match(
      textOf(html),
      /Retirer l’application Shop \? Les prochaines sessions ne la testent plus\. .* Les sources qui lui sont rattachées doivent d’abord en être détachées\. Annuler Retirer l’application Shop · shop/,
    );
    assert.match(html, /<button type="button" class="btn danger" data-rank="0">Retirer l’application<\/button>/);
    assert.match(page("#/applications/shop?drop=application", configurationAfter(stateAfter(), { type: "saving" })), /data-rank="0" disabled="">/);
  });

  it("shows the application being added, named by its rank until it has a name, which it offers to remove, beside the errors of the draft", () => {
    assert.doesNotMatch(page("#/applications?add=application"), /<form/, "nothing until the page added it");
    const added = stateAfter([{ type: "add", pointer: "/applications", item: NEW_ITEMS.application }]);
    const errors: ConfigError[] = [{ kind: "structure", path: "/applications/1/environments", rule: "too-few-items", message: "Too few items." }];
    const html = page("#/applications?add=application", { ...added, errors });
    const text = textOf(html);
    assert.match(text, /^shop-tests \/ Applications \/ Nouvelle application Nouvelle application 1 erreur à corriger avant d’enregistrer/);
    assert.match(text, /Application 2 · sans identifiant Retirer Identifiant/);
    assert.match(text, /Environnement 1 Environnement 1 Retirer Nom/);
    assert.match(html, /aria-label="Retirer l’environnement 1 de Application 2" data-remove="\/applications\/1\/environments\/0"/);
    assert.match(html, /<p class="field-error" role="note">Il en faut au moins un\.<\/p>/);
    assert.match(text, /Modifications non enregistrées Annuler les modifications Enregistrer$/);
  });
});
