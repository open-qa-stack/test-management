import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { errorText, LEVELS, levelText, originText } from "../../src/configuration/configuration-words.ts";

describe("the words of the configuration", () => {
  it("word an error of a rule the console knows, and give the message of the instance for any other", () => {
    assert.equal(
      errorText({ kind: "structure", path: "/model/apiKeyEnv", rule: "env-var-name", message: "Expected…" }),
      "Nom de variable d’environnement attendu : majuscules, chiffres et tirets bas, jamais la valeur.",
    );
    assert.equal(errorText({ kind: "structure", path: "/autonomy/level", rule: "retired-level", message: 'Write "bounded".' }), 'Write "bounded".');
  });

  it("name each origin of a revision and each level of the pyramid, from its base", () => {
    assert.deepEqual((["file", "console", "command"] as const).map(originText), ["Fichier oqas.json", "Console", "Commande"]);
    assert.deepEqual(LEVELS, ["smoke", "functional", "business", "cross-application", "end-to-end"]);
    assert.deepEqual(levelText("smoke"), { label: "Fumée", hint: "l’application répond" });
  });
});
