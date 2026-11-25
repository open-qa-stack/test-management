import assert from "node:assert/strict";
import { createElement } from "react";
import type { ConfigError, OqasConfig } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import { ConfigurationScreen, FORM_ID } from "../../src/configuration/configuration-screen.tsx";
import { configurationAfter, INITIAL_CONFIGURATION, type ConfigurationAction, type ConfigurationState } from "../../src/configuration/configuration-state.ts";
import { at, render, textOf } from "../render.ts";
import { BARE, DOCUMENT, REVISIONS, VIEW } from "./configuration-fixture.ts";
import { bears } from "./fields.ts";
import { UNCALLED_CONTROLS } from "./uncalled-controls.ts";

/** What the person does on the screen, which a static rendering never calls. */
const CONTROLS = UNCALLED_CONTROLS;

/** The state after the actions, from the state once the instance told the configuration of the fixtures. */
function stateAfter(actions: readonly ConfigurationAction[], document: OqasConfig = DOCUMENT): ConfigurationState {
  const view = { ...VIEW, revision: { ...VIEW.revision!, document } };
  return [{ type: "read", view, revisions: REVISIONS } as const, ...actions].reduce(configurationAfter, INITIAL_CONFIGURATION);
}

/** The screen in a state, as HTML. */
const screen = (state: ConfigurationState): string =>
  render(createElement(ConfigurationScreen, { project: "shop-tests", state, controls: CONTROLS, route: at("#/configuration") }));

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
      /L’instance n’a pas encore de configuration Écrivez oqas\.json à la racine du dépôt de tests : la console le reprend\. Prendre oqas\.json$/,
    );
  });

  it("shows the revision in force in a form of its own, its sections, and the history, with nothing to save while nothing changed", () => {
    const html = screen(stateAfter([]));
    const text = textOf(html);
    assert.match(html, new RegExp(`<form id="${FORM_ID}" class="config-form" noValidate="">`));
    assert.match(text, /Révision 2 en vigueur Historique et copies des réglages/);
    assert.doesNotMatch(html, /type="submit"/, "nothing to save, no button to save");
    assert.match(text, /Les réglages d’Open QA Stack\. Les applications testées et les connaissances que lisent les agents ont leurs propres écrans\./);
    assert.doesNotMatch(html, /name="\/(applications|knowledge)\//);
    for (const heading of ["Agents", "Dépôt de tests"]) assert.match(html, new RegExp(`<h2 id="[^"]+">${heading}</h2>`));
    assert.match(html, /<details class="config-section config-advanced"><summary><h2 id="config-history">Historique et copies des réglages<\/h2><\/summary>/);
    assert.match(text, /Révision 2 Console · .* en vigueur Révision 1 Fichier oqas\.json · /);
    assert.match(text, /Les valeurs tapées ici — clé, chaînes de connexion, mots de passe — restent sur l’ordinateur où tourne l’outil/);
    assert.match(html, /<summary>Voir la configuration en JSON<\/summary><pre class="mono">\{\n {2}&quot;formatVersion&quot;: 1,/);
  });

  it("gives every field a label, its value from the draft, and the defaults where the draft leaves a key out", () => {
    const html = screen(stateAfter([]));
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
    assert.match(
      html,
      /<legend>Niveau<\/legend><label class="check"><input type="radio" id="config-autonomy-level-bounded" data-kind="level" name="\/autonomy\/level" checked="" value="bounded"\/><span>Encadré \(recommandé\)/,
    );
    assert.match(html, /<input type="radio" id="config-autonomy-level-autonomous" data-kind="level" name="\/autonomy\/level" value="autonomous"\/>/);
    assert.ok(bears(html, "/autonomy/task/maxMinutes", 'value="10"'));
    assert.ok(bears(html, "/autonomy/guardrailMinutes", 'value="60"', 'placeholder="120"'));
    assert.ok(bears(html, "/design/levels", 'data-member="smoke"', 'checked=""', 'data-defaults="smoke,functional,business"'));
    assert.ok(!bears(html, "/design/levels", 'data-member="functional"', 'checked=""'));
    assert.ok(bears(html, "/repository/appsDir", 'value="tests"', 'placeholder="apps"'));
    assert.ok(bears(html, "/repository/blocksDir", 'value=""', 'placeholder="blocs"'));
  });

  it("lays out the defaults of a bare configuration: the bounded level, ten minutes a task, the two-hour guardrail", () => {
    const html = screen(stateAfter([], BARE));
    assert.ok(bears(html, "/autonomy/guardrailMinutes", 'value=""', 'placeholder="120"'));
    assert.ok(bears(html, "/autonomy/task/maxMinutes", 'value="10"'));
    assert.match(html, /checked="" value="bounded"/);
    for (const level of ["smoke", "functional", "business"]) assert.ok(bears(html, "/design/levels", `data-member="${level}"`, 'checked=""'), level);
  });

  it("says a change is not saved, and lets the person save it or drop it", () => {
    const html = screen(stateAfter([{ type: "edit", pointer: "/model/model", value: "other" }]));
    assert.match(textOf(html), /Modifications non enregistrées Annuler les modifications Enregistrer/);
    assert.match(html, /<button type="submit" class="btn primary">Enregistrer<\/button>/);
    assert.match(textOf(screen(stateAfter([{ type: "edit", pointer: "/model/model", value: "other" }, { type: "saving" }]))), /Enregistrement…/);
  });

  it("asks for the value of each variable beside it, and lets the person save the values typed alone", () => {
    const html = screen(stateAfter([{ type: "value", name: "MODEL_KEY", value: "typed" }]));
    for (const variable of ["MODEL_KEY"]) assert.match(html, new RegExp(`id="secret-${variable}"`));
    assert.match(textOf(html), /Modifications non enregistrées Annuler les modifications Enregistrer/);
    assert.match(html, /<button type="submit" class="btn primary">Enregistrer<\/button>/);
    const valued = stateAfter([{ type: "valued", secrets: [] }]);
    assert.match(screen(valued), /<p class="config-note ok" role="status">Les valeurs tapées sont enregistrées sur cet ordinateur\.<\/p>/);
    assert.match(
      textOf(screen(configurationAfter(valued, { type: "saved", view: VIEW }))),
      /Révision 2 enregistrée : elle est en vigueur, et la prochaine session la lit\. Les valeurs tapées sont enregistrées sur cet ordinateur\./,
    );
  });

  it("shows each error the instance found beside its field, and every one of them, counted, at the head of the form", () => {
    const errors: ConfigError[] = [
      { kind: "structure", path: "/model/apiKeyEnv", rule: "env-var-name", message: "Expected…" },
      { kind: "structure", path: "/applications/0/environments", rule: "too-few-items", message: "Too few items." },
      { kind: "structure", path: "", rule: "json", message: "The file is not valid JSON." },
    ];
    const state = stateAfter([{ type: "edit", pointer: "/model/apiKeyEnv", value: "bad name" }]);
    const html = screen({ ...configurationAfter(state, { type: "checked", draft: state.draft!, errors }), tried: true });
    assert.match(
      textOf(html),
      /3 erreurs à corriger avant d’enregistrer Modèle › Nom sous lequel la clé est gardée Nom de variable d’environnement attendu .* Shop Il en faut au moins un\. La configuration Le fichier n’est pas du JSON valide\./,
    );
    assert.ok(bears(html, "/model/apiKeyEnv", 'aria-invalid="true"', 'aria-describedby="config-model-apiKeyEnv-hint config-model-apiKeyEnv-errors"'));
    assert.match(html, /<span id="config-model-apiKeyEnv-errors" class="field-error">Nom de variable/);
    const one = configurationAfter(state, { type: "checked", draft: state.draft!, errors: errors.slice(0, 1) });
    assert.match(textOf(screen(one)), /1 erreur à corriger avant d’enregistrer/);
    const choice = configurationAfter(state, {
      type: "checked",
      draft: state.draft!,
      errors: [{ kind: "structure", path: "/model/mode", rule: "unknown-variant", message: "…" }],
    });
    assert.ok(bears(screen({ ...choice, tried: true }), "/model/mode", "select", 'aria-invalid="true"', 'aria-describedby="config-model-mode-errors"'));
  });

  it("tells beside the history how the file stands to the revision in force, with what writes or takes it, and that a change was saved", () => {
    const fileCard = (file: "in_step" | "changed" | "missing") =>
      textOf(screen(configurationAfter(stateAfter([]), { type: "read", view: { ...VIEW, file }, revisions: REVISIONS })));
    assert.match(fileCard("in_step"), /Fichier oqas\.json · une copie gardée avec les tests oqas\.json contient la révision en vigueur\. JSON/);
    assert.match(
      fileCard("changed"),
      /oqas\.json diffère de la révision en vigueur : écrivez-y la révision en vigueur, ou prenez-le à la place\. Écrire oqas\.json Prendre oqas\.json JSON ·/,
    );
    assert.match(fileCard("missing"), /Le dépôt de tests n’a pas encore de oqas\.json : .* git\. Écrire oqas\.json JSON ·/);
    const saved = configurationAfter(stateAfter([]), { type: "saved", view: VIEW });
    assert.match(screen(saved), /<p class="config-note ok" role="status">Révision 2 enregistrée : elle est en vigueur, et la prochaine session la lit\.<\/p>/);
  });

  it("says the project is ready once it was set up, committed or left to commit, and leads to the agent", () => {
    const ready = (committed: boolean) =>
      textOf(screen(configurationAfter(stateAfter([]), { type: "prepared", preparation: { created: [], kept: [], committed } })));
    assert.match(
      ready(true),
      /Le projet est prêt La configuration et le projet Playwright sont écrits et enregistrés dans un nouveau dépôt git\. Demander des tests à l’agent/,
    );
    assert.match(ready(false), /Le projet est prêt .* enregistrez-les dans git \(commit\) avant la première session\./);
  });

  it("says why a change was refused", () => {
    const stale = stateAfter([{ type: "refused", code: "stale_revision", text: "La configuration a changé.", errors: [] }]);
    assert.match(screen(stale), /<p class="config-note ko" role="alert">La configuration a changé\.<\/p>/);
  });

  it("hands the card of the model the latest test of its connection", () => {
    const state = configurationAfter(stateAfter([]), { type: "tested", model: DOCUMENT.model });
    const testing = configurationAfter(stateAfter([]), { type: "testing", model: DOCUMENT.model });
    assert.doesNotMatch(textOf(screen(state)), /Test en cours/);
    assert.match(textOf(screen(testing)), /Test en cours…/);
  });
});
