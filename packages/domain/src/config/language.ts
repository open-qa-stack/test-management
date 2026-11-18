import type { ConfigurationView } from "../configuration-life/configuration-view.ts";
import type { Language } from "./types.ts";

/** The languages the product speaks, as BCP 47 tags. */
export const LANGUAGES = ["en", "fr"] as const satisfies readonly Language[];

/** The language of a configuration that names none. */
export const DEFAULT_LANGUAGE: Language = "en";

/**
 * Tells the language of the person, as the configuration in force names it.
 *
 * @param view - The configuration of an instance as it is now.
 * @returns The language of its revision in force; English when it names none, or when there is none.
 */
export function languageOf(view: ConfigurationView): Language {
  return view.revision?.document.language ?? DEFAULT_LANGUAGE;
}
