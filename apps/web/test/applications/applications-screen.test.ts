import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { OqasConfig } from "@open-qa-stack/domain/sessions";
import type { ApplicationControls } from "../../src/applications/application-screen.tsx";
import { ApplicationsScreen } from "../../src/applications/applications-screen.tsx";
import { configurationAfter, INITIAL_CONFIGURATION, type ConfigurationState } from "../../src/configuration/configuration-state.ts";
import { parseRoute } from "../../src/routing/route.ts";
import { linksOf, render, textOf } from "../render.ts";
import { BARE, DOCUMENT, REVISIONS, VIEW } from "../configuration/configuration-fixture.ts";
import { UNCALLED_CONTROLS } from "../configuration/uncalled-controls.ts";

/** What the person does on the screens, which a static rendering never calls. */
const CONTROLS: ApplicationControls = {
  drop: () => assert.fail("no application is removed"),
  edit: UNCALLED_CONTROLS,
};

/** The draft once the instance told a configuration in force. */
const told = (document: OqasConfig = DOCUMENT): ConfigurationState =>
  configurationAfter(INITIAL_CONFIGURATION, { type: "read", view: { ...VIEW, revision: { ...VIEW.revision!, document } }, revisions: REVISIONS });

/** The screen of an address in a state, as HTML. */
const screen = (hash: string, state: ConfigurationState = told()): string =>
  render(createElement(ApplicationsScreen, { project: "shop-tests", route: parseRoute(hash), state, controls: CONTROLS }));

describe("the applications of the project", () => {
  it("says it reads the configuration until the instance told it, and why it could not", () => {
    assert.equal(
      textOf(screen("#/applications", INITIAL_CONFIGURATION)),
      "shop-tests / Applications Applications Lecture de la configuration Elle apparaît dès que l’instance a répondu.",
    );
    assert.match(textOf(screen("#/applications", { ...INITIAL_CONFIGURATION, unread: "Down." })), /Lecture de la configuration Down\.$/);
  });

  it("leads an instance without a configuration to set it up", () => {
    const html = screen("#/applications", configurationAfter(INITIAL_CONFIGURATION, { type: "read", view: { file: "missing" }, revisions: [] }));
    assert.match(textOf(html), /Aucune configuration pour l’instant Configurez le projet : ses applications se déclarent au démarrage\. Configurer le projet$/);
    assert.deepEqual(linksOf(html).at(-1), "#/configuration");
  });

  it("lists the applications of the configuration in force, each leading to its page, and leads to the page that adds one", () => {
    const html = screen("#/applications");
    assert.match(
      textOf(html),
      /^shop-tests \/ Applications Applications Ajouter une application Les applications que testent les agents, chacune avec ses environnements et ses API\. Shop Interface web et API · 1 environnement · 1 API · 1 compte de test shop$/,
    );
    assert.ok(linksOf(html).includes("#/applications/shop"));
    assert.ok(linksOf(html).includes("#/applications?add=application"));
    assert.doesNotMatch(html, /name="\/applications\//);
    const bare = screen(
      "#/applications",
      told({ ...BARE, applications: [{ ...BARE.applications[0]!, authentication: { method: "none" }, environments: [{ name: "local" }] }] }),
    );
    assert.match(textOf(bare), /Application 1 Interface web · 1 environnement · aucune API · aucun compte de test/);
  });

  it("shows the page of an application, and the application the person adds", () => {
    assert.match(textOf(screen("#/applications/shop")), /^shop-tests \/ Applications \/ Shop Shop Retirer l’application/);
    assert.match(textOf(screen("#/applications?add=application")), /^shop-tests \/ Applications \/ Nouvelle application Nouvelle application$/);
  });
});
