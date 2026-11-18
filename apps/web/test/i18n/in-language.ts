import { afterEach } from "vitest";
import type { Language } from "@open-qa-stack/domain/sessions";
import { i18n } from "../../src/i18n/i18n.ts";

/**
 * Has the console speak a language for the tests of a file, then French again after each test, as the other tests read it.
 *
 * @param language - The language.
 * @returns What sets it, to be awaited in a test.
 */
export function speaking(language: Language): () => Promise<void> {
  afterEach(async () => {
    await i18n.changeLanguage("fr");
  });
  return async () => {
    await i18n.changeLanguage(language);
  };
}
