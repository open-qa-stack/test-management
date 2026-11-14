import type { Target } from "./target.ts";

/**
 * The words that name an action that removes data, in the languages of the applications tested so far: a
 * button named by one of them is not clicked without a confirmation.
 */
const DESTRUCTIVE =
  /(?<![\p{L}\p{N}])(delete|remove|destroy|erase|purge|wipe|supprimer|effacer|retirer|löschen|entfernen|eliminar|borrar|eliminare|cancellare)(?![\p{L}\p{N}])/iu;

/**
 * Tells whether clicking an element may remove data of the application, from the name it is designated by.
 *
 * @remarks
 * The name is the accessible name of a role, a label or a text; a test id names nothing a person reads. It is
 * a guess from words: an element that removes data under another name is not seen, and one that only opens a
 * confirmation is seen all the same.
 *
 * @param target - The element.
 * @returns The name that says so, or `undefined` when none does.
 */
export function destructiveName(target: Target): string | undefined {
  const name = "role" in target ? target.name : "label" in target ? target.label : "text" in target ? target.text : undefined;
  return name !== undefined && DESTRUCTIVE.test(name) ? name.trim() : undefined;
}
