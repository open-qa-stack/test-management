import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { validateConfig } from "@open-qa-stack/domain";
import { configOf, isAddress, knowledgeOf, slugOf, sourceIds, valuesOf, type ProjectDraft } from "../../src/conversation/setup/project-setup/project-draft.ts";
import {
  DATABASE_VARIABLE,
  EXPOSES,
  PROJECT_START,
  projectSetupAfter,
  SOURCE_CHOICES,
  type ProjectSetupAction,
  type ProjectSetupState,
} from "../../src/conversation/setup/project-setup/project-setup-state.ts";

/** The setting up after the actions, from its start or from a state given. */
const after = (actions: readonly ProjectSetupAction[], from: ProjectSetupState = PROJECT_START): ProjectSetupState => actions.reduce(projectSetupAfter, from);

/** The actions that type a text and press Enter. */
const typing = (text: string): ProjectSetupAction[] => [{ type: "typed", text }, { type: "entered" }];

/** The actions that choose a line of the list of the step. */
const choosing = (index: number): ProjectSetupAction[] => [{ type: "moved", by: index }, { type: "chosen" }];

/** The setting up at the list of the knowledge, for an application with an interface. */
const AT_SOURCES = after([...typing("Shop"), ...choosing(0), ...typing("http://localhost:3000")]);

describe("the project set up in the terminal", () => {
  it("names the application by its name, and reads an address", () => {
    assert.equal(slugOf("Gestion des Contrats !"), "gestion-des-contrats");
    assert.equal(slugOf("Été 2026"), "ete-2026");
    assert.equal(slugOf("***"), "app");
    assert.equal(isAddress("https://shop.example.test"), true);
    assert.equal(isAddress("ftp://shop"), false);
    assert.equal(isAddress("shop"), false);
  });

  it("writes a configuration the schema takes, with each source attached to the application, and the values apart", () => {
    const draft: ProjectDraft = {
      name: "Shop",
      exposes: "web-and-api",
      uiUrl: "http://localhost:3000",
      apiUrl: "http://localhost:8080",
      sources: [
        { kind: "openapi", where: "http://localhost:8080/openapi.json" },
        { kind: "openapi", where: "specs/openapi.json" },
        { kind: "source-code", where: "../shop" },
        { kind: "postgresql", variable: "SHOP_DB_URL", value: "postgres://shop" },
        { kind: "postgresql", variable: "OTHER_DB_URL" },
        { kind: "documents" },
      ],
      model: { mode: "provider-key", provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1", apiKeyEnv: "OPENAI_API_KEY" },
      key: "sk-typed",
    };
    assert.deepEqual(sourceIds(draft.sources), ["api-contract", "api-contract-2", "code", "database", "database-2", "documents"]);
    const config = configOf(draft, "fr");
    const read = validateConfig(JSON.stringify(config), { SHOP_DB_URL: "x", OTHER_DB_URL: "x", OPENAI_API_KEY: "x" });
    assert.ok(read.ok, JSON.stringify(read));
    assert.deepEqual(config.applications[0]?.environments, [
      { name: "local", uiUrl: "http://localhost:3000", apis: [{ name: "api", baseUrl: "http://localhost:8080" }] },
    ]);
    assert.deepEqual(knowledgeOf({ kind: "documents" }, "documents", "shop"), {
      id: "documents",
      type: "document",
      stored: true,
      attachments: [{ application: "shop" }],
    });
    assert.deepEqual(valuesOf(draft), { SHOP_DB_URL: "postgres://shop", OPENAI_API_KEY: "sk-typed" });
    assert.deepEqual(valuesOf({ ...draft, model: { mode: "github", model: "m" } }), { SHOP_DB_URL: "postgres://shop" });
    const { key: _, ...keyless } = draft;
    assert.deepEqual(valuesOf(keyless), { SHOP_DB_URL: "postgres://shop" });
    const web = configOf({ name: "Shop", exposes: "web", uiUrl: "http://x", sources: [], model: { mode: "github", model: "m" } }, "en");
    assert.deepEqual(web.applications[0]?.environments, [{ name: "local", uiUrl: "http://x" }]);
    const api = configOf({ name: "Shop", exposes: "api", apiUrl: "http://x", sources: [], model: { mode: "github", model: "m" } }, "en");
    assert.deepEqual(api.applications[0]?.environments, [{ name: "local", apis: [{ name: "api", baseUrl: "http://x" }] }]);
  });
});

describe("the setting up of a project in the terminal", () => {
  it("asks the name, what the application exposes, then its addresses, refusing what is none", () => {
    assert.equal(after([{ type: "entered" }]).refusal, "name");
    assert.equal(after([...typing("Shop"), { type: "typed", text: "S" }]).refusal, undefined);
    const exposes = after(typing("Shop"));
    assert.deepEqual([exposes.step, exposes.draft.name], ["exposes", "Shop"]);
    assert.equal(after(choosing(EXPOSES.indexOf("api")), exposes).step, "apiUrl");
    const both = after(choosing(EXPOSES.indexOf("web-and-api")), exposes);
    assert.equal(both.step, "uiUrl");
    assert.equal(after(typing("nowhere"), both).refusal, "address");
    const api = after(typing("http://localhost:3000"), both);
    assert.deepEqual([api.step, api.draft.uiUrl], ["apiUrl", "http://localhost:3000"]);
    assert.equal(after(typing("nowhere"), api).refusal, "address");
    assert.deepEqual([AT_SOURCES.step, AT_SOURCES.draft.uiUrl], ["sources", "http://localhost:3000"]);
    assert.equal(after(typing("http://localhost:8080"), api).draft.apiUrl, "http://localhost:8080");
  });

  it("tests each source as soon as it is declared, keeps one that answers, and lets the person correct or give up one that does not", () => {
    const where = after(choosing(SOURCE_CHOICES.indexOf("openapi")), AT_SOURCES);
    assert.deepEqual([where.step, where.pending], ["where", { kind: "openapi" }]);
    assert.equal(after([{ type: "entered" }], where).refusal, "where");
    const checking = after(typing("specs/openapi.json"), where);
    assert.deepEqual([checking.step, checking.pending], ["checking", { kind: "openapi", where: "specs/openapi.json" }]);
    const failed = after([{ type: "checked", check: { state: "failed", reason: "ENOENT" } }], checking);
    assert.deepEqual([failed.step, failed.text, failed.failure], ["where", "specs/openapi.json", "ENOENT"]);
    assert.deepEqual(after([{ type: "dropped" }], failed).draft.sources, []);
    const kept = after([...typing("openapi.json"), { type: "checked", check: { state: "ok", items: 3 } }], failed);
    assert.deepEqual(
      [kept.step, kept.failure, kept.draft.sources],
      ["sources", undefined, [{ kind: "openapi", where: "openapi.json", check: { state: "ok", items: 3 } }]],
    );
  });

  it("asks a database for the name its connection string is kept under, then the string, unseen, which may be left to the environment", () => {
    const variable = after(choosing(SOURCE_CHOICES.indexOf("postgresql")), AT_SOURCES);
    assert.deepEqual([variable.step, variable.text], ["variable", DATABASE_VARIABLE]);
    assert.equal(after(typing("bad name"), variable).refusal, "variable");
    const value = after(typing("SHOP_DB_URL"), variable);
    assert.deepEqual([value.step, value.text], ["value", ""]);
    assert.deepEqual(after(typing("postgres://shop"), value).pending, { kind: "postgresql", variable: "SHOP_DB_URL", value: "postgres://shop" });
    const fromEnvironment = after([{ type: "entered" }], value);
    assert.deepEqual([fromEnvironment.step, fromEnvironment.pending], ["checking", { kind: "postgresql", variable: "SHOP_DB_URL" }]);
    const failed = after([{ type: "checked", check: { state: "failed", reason: "refused" } }], fromEnvironment);
    assert.deepEqual([failed.step, failed.text, failed.failure], ["value", "", "refused"]);
  });

  it("adds documents to give later, goes on to the model, then sums up and creates the project", () => {
    const documents = after(choosing(SOURCE_CHOICES.indexOf("documents")), AT_SOURCES);
    assert.deepEqual([documents.step, documents.draft.sources], ["sources", [{ kind: "documents" }]]);
    // The list stays on the line chosen: the next one goes on to the model.
    const model = after([{ type: "moved", by: 1 }, { type: "chosen" }], documents);
    assert.equal(model.step, "model");
    const summary = after([{ type: "modelled", model: { mode: "github", model: "gpt-5" }, key: undefined }], model);
    assert.deepEqual([summary.step, summary.draft.model, summary.draft.key], ["summary", { mode: "github", model: "gpt-5" }, undefined]);
    const keyed = after(
      [{ type: "modelled", model: { mode: "provider-key", provider: "openai", baseUrl: "http://x/v1", model: "m", apiKeyEnv: "K" }, key: "sk" }],
      model,
    );
    assert.equal(keyed.draft.key, "sk");
    assert.equal(after([{ type: "chosen" }], summary).step, "creating");
  });

  it("ignores what does not belong to the step it is at", () => {
    assert.equal(after([{ type: "moved", by: 1 }]), PROJECT_START);
    assert.equal(after([{ type: "chosen" }]), PROJECT_START);
    assert.equal(after([{ type: "dropped" }]), PROJECT_START);
    assert.equal(after([{ type: "checked", check: { state: "unchecked" } }]), PROJECT_START);
    assert.equal(after([{ type: "modelled", model: { mode: "github", model: "m" }, key: undefined }]), PROJECT_START);
    const checking = after([...choosing(SOURCE_CHOICES.indexOf("openapi")), ...typing("x")], AT_SOURCES);
    assert.equal(after([{ type: "entered" }], checking), checking);
  });
});
