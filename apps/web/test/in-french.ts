import { i18n } from "../src/i18n/i18n.ts";

// The tests of the console read it in French, the language they were written in; a test of another language sets it, and sets it back.
await i18n.changeLanguage("fr");
