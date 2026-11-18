import type { Language } from "./types.ts";

/** The languages the product speaks, as BCP 47 tags. */
export const LANGUAGES = ["en", "fr"] as const satisfies readonly Language[];

/** The language of a configuration that names none. */
export const DEFAULT_LANGUAGE: Language = "en";
