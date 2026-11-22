import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { placeText } from "../../src/configuration/config-place.ts";
import { errorText } from "../../src/configuration/configuration-words.ts";
import { DOCUMENT } from "./configuration-fixture.ts";

describe("a place of the configuration", () => {
  it("is named by its items and its field, as the person reads them", () => {
    assert.equal(placeText("", DOCUMENT), "La configuration");
    assert.equal(placeText("/applications/0/id", DOCUMENT), "Shop › Identifiant");
    assert.equal(placeText("/applications/0/environments/0/uiUrl", DOCUMENT), "Shop › Environnement local › Adresse de l’interface");
    assert.equal(placeText("/applications/0/environments/0/apis/0/baseUrl", DOCUMENT), "Shop › Environnement local › API backend › Adresse de base");
    assert.equal(placeText("/applications/0/authentication/accounts/0/passwordEnv", DOCUMENT), "Shop › Compte clerk › Variable du mot de passe");
    assert.equal(placeText("/knowledge/2/connectionStringEnv", DOCUMENT), "Source orders › Variable de la chaîne de connexion");
    assert.equal(placeText("/knowledge/0/attachments/0/application", DOCUMENT), "Source contract › Sert à 1 › Application");
    assert.equal(placeText("/model/apiKeyEnv", DOCUMENT), "Modèle › Variable qui tient la clé");
    assert.equal(placeText("/autonomy/level", DOCUMENT), "Autonomie › Niveau");
  });

  it("names an item without a name by its rank, and a key or an item it has no word for as it is", () => {
    const unnamed = {
      ...DOCUMENT,
      applications: [{ ...DOCUMENT.applications[0]!, name: "", environments: [{ name: "" }] }],
      knowledge: [{ id: "", type: "openapi", url: "" }],
    } as never;
    assert.equal(placeText("/applications/0/environments/0/name", unnamed), "Application 1 › Environnement 1 › Nom");
    assert.equal(placeText("/knowledge/0/url", unnamed), "Source 1 › Adresse du contrat");
    assert.equal(placeText("/design/levels/1", DOCUMENT), "Niveaux de conception › levels › 2");
    assert.equal(placeText("/applications/0/tags", DOCUMENT), "Shop › tags");
    assert.equal(placeText("/unknown", undefined), "unknown");
  });
});

describe("an error of the configuration, in words", () => {
  it("asks to fill a field left empty, whatever rule it breaks, and words the rule otherwise", () => {
    const error = { kind: "reference", path: "/knowledge/0/id", rule: "slug", message: "Expected a slug." } as const;
    const empty = { ...DOCUMENT, knowledge: [{ ...DOCUMENT.knowledge[0]!, id: "" }] };
    assert.equal(errorText(error, empty), "Champ obligatoire.");
    assert.equal(errorText(error, DOCUMENT), "Minuscules et chiffres, séparés par des tirets.");
    assert.equal(errorText(error), "Minuscules et chiffres, séparés par des tirets.");
  });
});
