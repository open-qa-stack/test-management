import type { Target } from "./target.ts";

/**
 * The words that name an action that removes data, in the languages of the applications tested so far: a
 * button named by one of them is not clicked without a confirmation.
 */
const DESTRUCTIVE =
  /(?<![\p{L}\p{N}])(delete|remove|destroy|erase|purge|wipe|supprimer|effacer|retirer|löschen|entfernen|eliminar|borrar|eliminare|cancellare)(?![\p{L}\p{N}])/iu;

/**
 * The words that name an action that creates or changes data, in the same languages: a button named by one
 * of them is not clicked by an agent that explores an environment it may only read.
 */
const CHANGING =
  /(?<![\p{L}\p{N}])(create|save|submit|update|add|send|accept|reject|approve|confirm|apply|respond|pay|upload|import|créer|enregistrer|sauvegarder|valider|modifier|ajouter|envoyer|accepter|refuser|confirmer|répondre|payer|erstellen|speichern|senden|hinzufügen|crear|guardar|enviar|aceptar|creare|salvare|inviare)(?![\p{L}\p{N}])/iu;

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
  const name = nameOf(target);
  return name !== undefined && DESTRUCTIVE.test(name) ? name.trim() : undefined;
}

/**
 * Tells whether clicking an element may create or change data of the application, from the name it is
 * designated by: the same guess from words as `destructiveName`, for the words that create or change.
 *
 * @param target - The element.
 * @returns The name that says so, or `undefined` when none does.
 */
export function changingName(target: Target): string | undefined {
  const name = nameOf(target);
  return name !== undefined && CHANGING.test(name) ? name.trim() : undefined;
}

/** The name a person reads of an element: that of its role, its label or its text; none for a test id. */
function nameOf(target: Target): string | undefined {
  return "role" in target ? target.name : "label" in target ? target.label : "text" in target ? target.text : undefined;
}
