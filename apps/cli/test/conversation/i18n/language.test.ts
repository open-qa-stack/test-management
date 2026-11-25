import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { LANGUAGES, type Session, type SessionResult, type SessionTest } from "@open-qa-stack/domain/sessions";
import { i18n, RESOURCES } from "../../../src/conversation/i18n/i18n.ts";
import { standing, stateText } from "../../../src/conversation/view/session-facts.ts";
import { after, COMPLETED, endOf, showing } from "../support/fixtures.ts";
import { screenOf } from "../support/screen.ts";

/** Every word of some resources, by the path of its key. */
function wordsOf(words: object, prefix = ""): (readonly [string, string])[] {
  return Object.entries(words).flatMap(([key, value]) =>
    typeof value === "string" ? [[`${prefix}${key}`, value] as const] : wordsOf(value as object, `${prefix}${key}.`),
  );
}

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("the words of the conversation", () => {
  it("are given whole in each language the configuration may name, none empty", () => {
    assert.deepEqual(Object.keys(RESOURCES), [...LANGUAGES]);
    const english = wordsOf(RESOURCES.en).map(([key]) => key);
    for (const language of LANGUAGES) {
      const words = wordsOf(RESOURCES[language]);
      assert.deepEqual(words.map(([key]) => key).sort(), [...english].sort(), language);
      assert.deepEqual(
        words.filter(([, word]) => word.trim() === ""),
        [],
        language,
      );
    }
  });
});

describe("the conversation in French", () => {
  it("tells the start, a thread and what the session came to in French, its keys and its numbers as French writes them", async () => {
    await i18n.changeLanguage("fr");
    const home = screenOf(after([]), 100);
    assert.equal(home[2], "environnement local · base SQLite");
    assert.ok(home.includes("Dernières sessions"), home.join("\n"));
    assert.deepEqual(home.slice(-2), ["›  Qu’est-ce qu’on teste ?", "  Entrée ouvrir une session · / commandes · Ctrl-C quitter"]);
    const ended: Session = { ...COMPLETED, result: { ...COMPLETED.result!, durationMs: 1500 } };
    const lines = screenOf(after(endOf(ended), showing()), 100).join("\n");
    assert.match(lines, /Session session-\S+ · ouverte le 2026-11-13 à 14:44:05 UTC/);
    assert.match(lines, /Verdicts de l’exécution : 2 tests\n✓ réussi {2}searches a customer/);
    assert.match(lines, /Session terminée · tests réussis\n1,5 s · 17 requêtes au modèle · 2 sur 2 tests réussis · branche /);
    assert.match(lines, /Que font les agents ensuite \?\n {2}Entrée poursuivre · \/new une autre session · Ctrl-C quitter$/);
  });

  it("writes a verdict of a test it does not know as the contract names it", async () => {
    await i18n.changeLanguage("fr");
    const later: Session = {
      ...COMPLETED,
      result: { ...COMPLETED.result!, tests: [{ id: "searches", verdict: "held_back" as SessionTest["verdict"], reason: "Later." }] },
    };
    assert.match(screenOf(after(endOf(later), showing()), 100).join("\n"), /! held back {2}searches/);
  });
});

describe("how a session stands, in a word", () => {
  it("names a state and an outcome the terminal does not know as a session that ended, and writes the state as it is", () => {
    assert.equal(stateText("archived"), "archived");
    assert.equal(standing({ ...COMPLETED, result: { ...COMPLETED.result!, outcome: "postponed" as SessionResult["outcome"] } }), "ended");
  });
});
