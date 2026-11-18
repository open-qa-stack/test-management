import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from "@open-qa-stack/domain/sessions";
import en from "./en.json" with { type: "json" };
import fr from "./fr.json" with { type: "json" };

declare module "i18next" {
  interface CustomTypeOptions {
    resources: { translation: typeof en };
  }
}

/** The words of the console, by key, as the English resources hold them. */
export type Words = typeof en;

/** The words of the console in each language the configuration may name. */
export const RESOURCES: Readonly<Record<Language, Words>> = { en, fr };

/** Each language the configuration may name, by its own name, as a person who reads it looks for it. */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = { en: "English", fr: "Français" };

/**
 * The words of the console, in the language of the configuration in force: English until it is read, or the
 * language of the browser when the application says so.
 */
export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  resources: Object.fromEntries(LANGUAGES.map((language) => [language, { translation: RESOURCES[language] }])),
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: LANGUAGES,
  nonExplicitSupportedLngs: true,
  initAsync: false,
  // React escapes what it draws.
  interpolation: { escapeValue: false },
});

/** Words a key of the resources in the language of the console. */
export const t = i18n.t;

/** @returns The language the console speaks now, as Intl names it. */
export function locale(): Language {
  // The instance is initialised at once, on the languages it supports: it always resolves one of them.
  return i18n.resolvedLanguage as Language;
}
