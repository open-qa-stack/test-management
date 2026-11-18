import type { Language } from "@open-qa-stack/domain";

/** How the instructions name each language, with its tag. */
const NAMES: Readonly<Record<Language, string>> = { en: "English (en)", fr: "French (fr)" };

/**
 * The rule of the language of the person, added to the instructions of every session of a run.
 *
 * @param language - The language the person reads.
 * @returns The rule: what the agent says to the person is written in that language, and nothing else changes.
 */
export function languageRule(language: Language): string {
  return `Language of the person. Write what is meant for the person in ${NAMES[language]}: what you say, the reasons you give, such as those of uncovered, and the findings and remarks you report. These instructions, the messages of the harness, the names of the tools and of their fields, and the identifiers stay as they are.`;
}

/**
 * The rule of the language of the tests, added to the instructions of the agents that plan and write them.
 *
 * @param language - The language of the tests.
 * @returns The rule: what the tests say is written in that language, their code and what the application shows are not.
 */
export function testLanguageRule(language: Language): string {
  return `Language of the tests. Write what the tests say in ${NAMES[language]}: the titles of the scenarios and of the tests, their steps, and the intents written in their code. The code itself, its names included, stays in English, and a text the application shows is quoted as it shows it, never translated.`;
}
