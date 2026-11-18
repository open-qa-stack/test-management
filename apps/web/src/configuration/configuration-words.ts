import type { ConfigError, RevisionOrigin, TestLevel } from "@open-qa-stack/domain/sessions";

/** How the console words each rule of the schema of the configuration: the API writes its messages for a developer. */
const RULES: Readonly<Record<string, string>> = {
  "wrong-type": "Type de valeur inattendu.",
  "unknown-variant": "Valeur non prise en charge.",
  "too-few-items": "Il en faut au moins un.",
  "too-few-keys": "Renseignez au moins une valeur.",
  "empty-value": "Ce champ ne peut pas être vide.",
  "below-minimum": "Valeur trop petite.",
  maximum: "Valeur trop grande.",
  uniqueItems: "Chaque valeur ne figure qu’une fois.",
  "env-var-name": "Nom de variable d’environnement attendu : majuscules, chiffres et tirets bas, jamais la valeur.",
  slug: "Minuscules et chiffres, séparés par des tirets.",
  required: "Champ obligatoire.",
  "unknown-key": "Clé inconnue.",
  "duplicate-key": "Clé répétée.",
  duplicate: "Cette valeur est déjà utilisée.",
  "ui-url-required": "Une application web a besoin de l’adresse de son interface.",
  "url-absolute": "Adresse absolue attendue, comme https://exemple.test.",
  "url-scheme": "Adresse http ou https attendue.",
  "url-credentials": "Une adresse ne contient ni identifiant ni mot de passe.",
  "unknown-reference": "Rien de ce nom n’est déclaré.",
  "api-without-environment": "Une API se désigne dans un environnement.",
  "path-absolute": "Chemin relatif à la racine du dépôt de tests attendu.",
  "path-outside-root": "Le chemin sort du dépôt de tests.",
  "path-invalid": "Le chemin contient des caractères de contrôle.",
  "format-version": "Version de format non prise en charge : 1 est attendu.",
  json: "Le fichier n’est pas du JSON valide.",
};

/**
 * Words an error of the configuration for the person.
 *
 * @param error - The error, as the instance found it.
 * @returns The wording of the console for a rule it knows; the message of the instance otherwise.
 */
export function errorText(error: ConfigError): string {
  return RULES[error.rule] ?? error.message;
}

/** Where each revision comes from, in the words of the console. */
export const ORIGINS: Readonly<Record<RevisionOrigin, string>> = {
  file: "Fichier oqas.json",
  console: "Console",
  command: "Commande oqas config export",
};

/** The levels of the pyramid of tests, from its base to its top, with what each covers. */
export const LEVELS: readonly { readonly level: TestLevel; readonly label: string; readonly hint: string }[] = [
  { level: "smoke", label: "Fumée", hint: "l’application répond" },
  { level: "functional", label: "Fonctionnel", hint: "un comportement d’un écran" },
  { level: "business", label: "Métier", hint: "un parcours sur plusieurs écrans" },
  { level: "cross-application", label: "Inter-applications", hint: "une action et son effet dans une autre application" },
  { level: "end-to-end", label: "De bout en bout", hint: "un parcours sur trois applications ou plus" },
];

/**
 * Writes a date for the person.
 *
 * @param iso - The date, in ISO 8601.
 * @returns It in French, to the minute, in the time zone of the browser.
 */
export function dateText(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}
