import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { LANGUAGES } from "@open-qa-stack/domain/sessions";
import { i18n, locale, RESOURCES, t } from "../../src/i18n/i18n.ts";
import { speaking } from "./in-language.ts";

/** Every word of some resources, by the path of its key. */
function wordsOf(words: object, prefix = ""): (readonly [string, string])[] {
  return Object.entries(words).flatMap(([key, value]) =>
    typeof value === "string" ? [[`${prefix}${key}`, value] as const] : wordsOf(value as object, `${prefix}${key}.`),
  );
}

const inEnglish = speaking("en");

describe("the words of the console", () => {
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

  it("are those of the language set, a regional variant read as its language, and English for a language without words", async () => {
    await inEnglish();
    assert.equal(t("home.title"), "What do we test?");
    assert.equal(locale(), "en");
    await i18n.changeLanguage("fr-CA");
    assert.equal([locale(), t("home.title")].join(" "), "fr Qu’est-ce qu’on teste ?");
    await i18n.changeLanguage("de");
    assert.equal([locale(), t("home.title")].join(" "), "en What do we test?");
  });

  it("count in the singular or the plural as each language has it: French in the singular below two", async () => {
    assert.deepEqual(
      [0, 1, 2].map((count) => t("count.scenarios", { count })),
      ["0 scénario", "1 scénario", "2 scénarios"],
    );
    await inEnglish();
    assert.deepEqual(
      [0, 1, 2].map((count) => t("count.scenarios", { count })),
      ["0 scenarios", "1 scenario", "2 scenarios"],
    );
  });
});
