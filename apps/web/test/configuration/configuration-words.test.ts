import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { errorText, originText } from "../../src/configuration/configuration-words.ts";

describe("the words of the configuration", () => {
  it("word an error of a rule the console knows, and give the message of the instance for any other", () => {
    assert.equal(
      errorText({ kind: "structure", path: "/model/apiKeyEnv", rule: "env-var-name", message: "Expected…" }),
      "Nom de variable d’environnement attendu : majuscules, chiffres et tirets bas, jamais la valeur.",
    );
    assert.equal(errorText({ kind: "structure", path: "/autonomy/level", rule: "retired-level", message: 'Write "bounded".' }), 'Write "bounded".');
  });

  it("name each origin of a revision", () => {
    assert.deepEqual((["file", "console", "command"] as const).map(originText), ["Fichier oqas.json", "Console", "Commande"]);
  });
});
