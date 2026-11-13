import { stripTypeScriptTypes } from "node:module";

/** The comments of a script, to remove. */
const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

/**
 * Tells whether a TypeScript file only declares types. Such a file has no code to run, and a test that loads
 * it at run time is impossible: its importers import its types only, which disappear with them.
 *
 * @param text - The text of the file.
 * @returns `true` when nothing but whitespace and comments remains of it once its types are removed.
 */
export function declaresTypesOnly(text: string): boolean {
  return stripTypeScriptTypes(text).replace(COMMENTS, "").trim() === "";
}
