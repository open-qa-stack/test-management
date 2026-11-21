import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { ConfigurationControls } from "../../src/configuration/configuration-screen.tsx";
import { configurationAfter, INITIAL_CONFIGURATION, type ConfigurationAction, type ConfigurationState } from "../../src/configuration/configuration-state.ts";
import { FIRST_DRAFT, FirstUse, type FirstUseStep } from "../../src/configuration/first-use.tsx";
import { render, textOf } from "../render.ts";
import { DOCUMENT, REVISIONS, VIEW } from "./configuration-fixture.ts";

/** What the person does on the screen, which a static rendering never calls. */
const CONTROLS: ConfigurationControls = {
  change: () => assert.fail("nothing is changed"),
  click: () => assert.fail("nothing is pressed"),
  save: () => assert.fail("nothing is saved"),
  discard: () => assert.fail("nothing is dropped"),
  keepFile: () => assert.fail("no file is taken"),
  keepChange: () => assert.fail("no change is kept"),
  testModel: () => assert.fail("no connection is tested"),
  checkSource: () => assert.fail("no source is tested"),
  setUp: () => assert.fail("nothing is set up"),
};

/** The moves from a step to another, which a static rendering never makes. */
const MOVES = { onBack: () => assert.fail("no step is left"), onNext: () => assert.fail("no step is left") };

/** The state of an instance that has no configuration, once the person began with a draft, then after the actions. */
function begun(document = FIRST_DRAFT, ...actions: readonly ConfigurationAction[]): ConfigurationState {
  return [{ type: "read", view: { file: "missing" }, revisions: [] } as const, { type: "begin", document } as const, ...actions].reduce(
    configurationAfter,
    INITIAL_CONFIGURATION,
  );
}

/** The setting up at a step, as the text a person reads. */
const at = (step: FirstUseStep, state: ConfigurationState = begun()): string =>
  textOf(render(createElement(FirstUse, { project: "shop-tests", state, controls: CONTROLS, step, ...MOVES })));

describe("the setting up of an instance that has no configuration", () => {
  it("begins from a draft only while there is neither a draft nor a revision, and keeps where the repository stands and what its setup did", () => {
    const state = begun(FIRST_DRAFT);
    assert.deepEqual([state.draft, state.basedOn], [FIRST_DRAFT, 0]);
    assert.equal(configurationAfter(state, { type: "begin", document: DOCUMENT }), state);
    const { draft: _, ...configured } = configurationAfter(INITIAL_CONFIGURATION, { type: "read", view: VIEW, revisions: REVISIONS });
    assert.equal(configurationAfter(configured, { type: "begin", document: FIRST_DRAFT }).draft, undefined);
    const preparation = { created: ["package.json"], kept: [], committed: true };
    const after = begun(FIRST_DRAFT, { type: "repository", repository: { git: "empty", playwright: false } }, { type: "prepared", preparation });
    assert.deepEqual([after.repository, after.preparation], [{ git: "empty", playwright: false }, preparation]);
  });

  it("opens on a welcome that says what the tool does, with no steps to show yet", () => {
    const html = render(createElement(FirstUse, { project: "shop-tests", state: begun(), controls: CONTROLS, step: "welcome", ...MOVES }));
    assert.match(textOf(html), /^shop-tests \/ Démarrer Bienvenue Des agents découvrent votre application.* Rien n’est écrit avant la dernière\. Commencer$/);
    assert.doesNotMatch(html, /first-use-steps/);
  });

  it("shows the steps, the one the person is at marked, with the cards of the configuration", () => {
    const applications = render(createElement(FirstUse, { project: "shop-tests", state: begun(), controls: CONTROLS, step: "applications", ...MOVES }));
    assert.match(applications, /<li aria-current="step">Applications<\/li>/);
    assert.match(textOf(applications), /Vos applications .* Ajouter une application Retour Suivant$/);
    assert.match(at("knowledge", begun(DOCUMENT)), /Ce que les agents peuvent lire .* Contrat OpenAPI Retirer Identifiant/);
    // A person who is not in IT is offered four kinds: a contract of an API, the code, a database, documents.
    assert.match(
      at("knowledge"),
      /plus tard\. Ajouter un contrat OpenAPI Ajouter du code source Ajouter une base PostgreSQL Ajouter des documents déposés Retour Suivant$/,
    );
    assert.match(at("model"), /Récapitulatif Le modèle avec lequel les agents réfléchissent .* Compte GitHub de cette machine/);
    assert.match(at("model", begun(FIRST_DRAFT, { type: "testing", model: FIRST_DRAFT.model })), /Test en cours…/);
    const source = DOCUMENT.knowledge[0]!;
    assert.match(at("knowledge", begun(DOCUMENT, { type: "sourceChecking", rank: 0, source })), /Test en cours…/);
  });

  it("sums up what it will write, whether the folder becomes a git repository, and the errors left to correct", () => {
    assert.match(at("summary"), /dans ce dossier\. 1 application : sans nom Aucune source de connaissance pour l’instant Modèle/);
    assert.match(at("summary", begun({ ...FIRST_DRAFT, applications: [] })), /dans ce dossier\. Aucune application Aucune/);
    const named = begun(DOCUMENT, { type: "repository", repository: { git: "none", playwright: false } });
    assert.match(
      at("summary", named),
      /dans ce dossier\. 1 application : Shop 8 sources de connaissance Chacune est cartographiée dès la création du projet, puis l’ensemble est mis en commun par domaine\. Modèle : test-model, par une clé de fournisseur Ce dossier deviendra un dépôt git, et ce qui est créé y sera enregistré\. Retour Créer le projet$/,
    );
    assert.match(at("summary"), /Modèle : , par le compte GitHub de cette machine Ce dossier est déjà un dépôt git/);
    const wrong = begun(FIRST_DRAFT, {
      type: "checked",
      draft: FIRST_DRAFT,
      errors: [{ kind: "structure", path: "/model/model", rule: "empty-value", message: "Empty." }],
    });
    assert.match(at("summary", wrong), /1 erreur/);
  });

  it("says it creates the project while the instance does, and why the instance refused it", () => {
    assert.match(at("summary", begun(FIRST_DRAFT, { type: "saving" })), /Création du projet…$/);
    const refused = begun(FIRST_DRAFT, { type: "refused", code: "unavailable", text: "L’instance ne répond pas.", errors: [] });
    assert.match(at("summary", refused), /L’instance ne répond pas\./);
  });
});
