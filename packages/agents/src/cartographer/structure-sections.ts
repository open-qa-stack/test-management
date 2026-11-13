import { nameWords } from "./element-words.ts";

/** The words, as `nameWords` gives them, of the titles that name a part of a document rather than what it is about. */
const STRUCTURE_WORDS = new Set([
  "acceptance",
  "appendix",
  "assumption",
  "background",
  "content",
  "context",
  "criteria",
  "criterion",
  "glossary",
  "goal",
  "history",
  "introduction",
  "issue",
  "note",
  "objective",
  "open",
  "overview",
  "point",
  "prerequisite",
  "purpose",
  "question",
  "reference",
  "scope",
  "summary",
  "table",
  "test",
  "testing",
  "acceptation",
  "annexe",
  "but",
  "contexte",
  "critere",
  "glossaire",
  "historique",
  "objectif",
  "ouvert",
  "perimetre",
  "resume",
  "sommaire",
]);

/**
 * Whether the title of a section of a document names a part of its structure — its purpose, its scope, its
 * acceptance criteria, its open points — rather than a functional area of the application.
 *
 * @param title - The title of the section, as its card gives it.
 * @returns `true` when it has words and every one is a word of structure.
 */
export function isStructureSection(title: string): boolean {
  const words = nameWords(title);
  return words.length > 0 && words.every((word) => STRUCTURE_WORDS.has(word));
}
