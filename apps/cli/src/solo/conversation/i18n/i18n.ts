import i18next from "i18next";
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from "@open-qa-stack/domain";
import en from "./en.json" with { type: "json" };
import fr from "./fr.json" with { type: "json" };

declare module "i18next" {
  interface CustomTypeOptions {
    resources: { translation: typeof en };
  }
}

/** The words of the conversation, by key, as the English resources hold them. */
export type Words = typeof en;

/** The words of the conversation in each language the configuration may name. */
export const RESOURCES: Readonly<Record<Language, Words>> = { en, fr };

/** The words of the conversation, in the language of the configuration in force once the conversation is told it; English until then. */
export const i18n = i18next.createInstance();

void i18n.init({
  resources: Object.fromEntries(LANGUAGES.map((language) => [language, { translation: RESOURCES[language] }])),
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: LANGUAGES,
  initAsync: false,
  // A terminal draws text as it is.
  interpolation: { escapeValue: false },
});

/** Words a key of the resources in the language of the conversation. */
export const t = i18n.t;
