import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { dateText, errorText, LEVELS, ORIGINS } from "../../src/configuration/configuration-words.ts";

describe("the words of the configuration", () => {
  it("word an error of a rule the console knows, and give the message of the instance for any other", () => {
    assert.equal(
      errorText({ kind: "structure", path: "/model/apiKeyEnv", rule: "env-var-name", message: "Expected…" }),
      "Nom de variable d’environnement attendu : majuscules, chiffres et tirets bas, jamais la valeur.",
    );
    assert.equal(errorText({ kind: "structure", path: "/autonomy/level", rule: "retired-level", message: 'Write "bounded".' }), 'Write "bounded".');
  });

  it("name each origin of a revision and each level of the pyramid, from its base", () => {
    assert.deepEqual(Object.keys(ORIGINS), ["file", "console", "command"]);
    assert.deepEqual(
      LEVELS.map(({ level }) => level),
      ["smoke", "functional", "business", "cross-application", "end-to-end"],
    );
  });

  it("write a date in French, to the minute", () => {
    assert.match(dateText("2026-11-18T09:12:00.000Z"), /^18\/11\/2026 \d\d:\d\d$/);
  });
});
