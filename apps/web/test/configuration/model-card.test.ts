import assert from "node:assert/strict";
import { MODEL_PROVIDERS, type Model, type ModelConnectionCheck } from "@open-qa-stack/domain/sessions";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { ConnectionTest } from "../../src/configuration/configuration-state.ts";
import { ModelCard } from "../../src/configuration/model-card.tsx";
import { render, textOf } from "../render.ts";

const LOCAL: Model = { mode: "provider-key", provider: "openai", baseUrl: "http://localhost:1234/v1", model: "local", apiKeyEnv: "LOCAL_KEY" };
const OPENAI: Model = { mode: "provider-key", provider: "openai", baseUrl: "https://api.openai.com/v1", model: "", apiKeyEnv: "OPENAI_API_KEY" };
const GITHUB: Model = { mode: "github", model: "" };
const IGNORED = (): void => assert.fail("nothing is tested");

/** The card of a model, with the latest test of its connection. */
const card = (model: Model, connection?: ConnectionTest): string =>
  render(createElement(ModelCard, { model, onTest: IGNORED, ...(connection === undefined ? {} : { connection }) }));

/** The text of the card once a test of its connection found something. */
const told = (model: Model, check: ModelConnectionCheck): string => textOf(card(model, { model, check }));

describe("the card of the model", () => {
  it("lists the GitHub account first, then the providers, then another server, and asks for nothing more with the account", () => {
    const html = card(GITHUB);
    const providers = MODEL_PROVIDERS.map(({ name }) => name).join(" ");
    assert.ok(
      textOf(html).includes(
        `Connexion au modèle Compte GitHub de cette machine (Copilot) ${providers} Autre serveur (adresse à saisir) Modèle Son nom, tel que le serveur le donne, par exemple gpt-4.1. L’outil utilise le compte GitHub`,
      ),
      textOf(html),
    );
    assert.doesNotMatch(html, /config-model-apiKeyEnv|config-model-baseUrl|requestTimeoutSeconds/);
  });

  it("asks a provider for the variable of its key only, and another server for its address too", () => {
    const provider = card(OPENAI);
    assert.match(provider, /id="config-model-apiKeyEnv"/);
    assert.doesNotMatch(provider, /id="config-model-baseUrl"/);
    const other = card(LOCAL);
    assert.match(other, /id="config-model-baseUrl"[^>]*value="http:\/\/localhost:1234\/v1"/);
    assert.match(other, /id="config-model-requestTimeoutSeconds"/);
  });

  it("says a test runs, and does not take another until it ends, then says why one could not be made", () => {
    const testing = card(LOCAL, { model: LOCAL });
    assert.match(textOf(testing), /Test en cours…/);
    assert.match(testing, /<button type="button" class="btn" disabled="">Tester la connexion<\/button>/);
    const failed = card(LOCAL, { model: LOCAL, failure: "L’instance ne répond pas." });
    assert.match(textOf(failed), /Le test n’a pas pu être fait : L’instance ne répond pas\./);
    assert.match(failed, /<button type="button" class="btn">Tester la connexion<\/button>/);
  });

  it("forgets a test made for another way to reach the model", () => {
    assert.doesNotMatch(textOf(card(OPENAI, { model: LOCAL, check: { state: "unreachable", url: "x" } })), /Rien ne répond/);
  });

  it("says in plain words what the test found, and what to do when it fails", () => {
    assert.match(told(GITHUB, { state: "signed-out" }), /Aucun compte GitHub n’est connecté sur cette machine\. .* gh auth login/);
    assert.match(told(GITHUB, { state: "no-models", account: "octo" }), /Le compte GitHub octo est connecté, mais Copilot ne lui propose aucun modèle/);
    assert.match(
      told(OPENAI, { state: "key-missing", variable: "OPENAI_API_KEY" }),
      /OPENAI_API_KEY ne tient aucune clé ici : tapez-la ci-dessus, puis testez à nouveau\./,
    );
    assert.match(told(OPENAI, { state: "key-refused", status: 401 }), /Le fournisseur a refusé la clé \(statut 401\)/);
    assert.match(told(LOCAL, { state: "unreachable", url: "http://localhost:1234/v1" }), /Rien ne répond à l’adresse http:\/\/localhost:1234\/v1/);
    assert.match(told(LOCAL, { state: "connected" }), /Connecté\. Le serveur ne donne pas la liste de ses modèles : saisissez le nom du modèle\./);
  });

  it("offers a model for each role: its name, or one of the models found, with whether it reads images once it has one", () => {
    const typed = card({ ...LOCAL, roles: { reviewer: { model: "big", capabilities: ["vision"] } } });
    const cartographer = /<input id="config-model-roles-cartographer"[^>]*>/.exec(typed)![0];
    for (const said of ['data-kind="role"', 'value=""', 'placeholder="Même modèle que ci-dessus"']) assert.ok(cartographer.includes(said), cartographer);
    assert.match(typed, /id="config-model-roles-reviewer"[^>]*value="big"/);
    assert.match(typed, /id="config-model-roles-reviewer-capabilities-vision"[^>]*checked=""/);
    assert.doesNotMatch(typed, /config-model-roles-cartographer-capabilities/);
    const models = [
      { id: "gpt-5", name: "GPT-5", reasoningEfforts: [] },
      { id: "mini", name: "mini", reasoningEfforts: [] },
    ];
    const check = { state: "connected", account: "octo", models } as const;
    const listed = card({ mode: "github", model: "gpt-5", roles: { designer: { model: "gone" } } }, { model: GITHUB, check });
    assert.match(
      listed,
      /<select id="config-model-roles-cartographer"[^>]*><option value="" selected="">Même modèle que ci-dessus<\/option><option value="gpt-5">GPT-5 \(gpt-5\)<\/option><option value="mini">/,
    );
    assert.match(listed, /<select id="config-model-roles-designer"[^>]*>.*?<option value="gone" selected="">gone<\/option>/);
  });

  it("offers the models found in a list, with the efforts of reasoning and the vision of the one chosen", () => {
    const models = [
      { id: "gpt-5", name: "GPT-5", vision: true, reasoningEfforts: ["low", "high"] },
      { id: "mini", name: "mini", reasoningEfforts: [] },
    ];
    const listed = card({ mode: "github", model: "gpt-5" }, { model: GITHUB, check: { state: "connected", account: "octo", models } });
    assert.match(textOf(listed), /Connecté avec le compte GitHub octo\. Choisissez un modèle dans la liste\./);
    assert.match(
      listed,
      /<select id="config-model-model"[^>]*><option value="">Choisir un modèle<\/option><option value="gpt-5" selected="">GPT-5 \(gpt-5\)<\/option><option value="mini">mini<\/option><\/select>/,
    );
    assert.match(
      listed,
      /<select id="config-model-reasoningEffort"[^>]*><option value="" selected="">Par défaut<\/option><option value="low">low<\/option><option value="high">high<\/option>/,
    );
    assert.match(textOf(listed), /la liste indique que ce modèle lit les images/);
    const none = card({ mode: "github", model: "mini" }, { model: GITHUB, check: { state: "connected", account: "octo", models } });
    assert.match(none, /<input id="config-model-reasoningEffort"/);
    assert.match(textOf(none), /les agents voient les captures des écrans/);
  });
});
