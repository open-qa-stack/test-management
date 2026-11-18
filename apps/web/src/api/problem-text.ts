import type { ProblemCode } from "@open-qa-stack/domain/sessions";

/** How the console words each problem it knows: the API writes its details for a developer, not for the person. */
const WORDINGS: Readonly<Record<Exclude<ProblemCode, "error">, string>> = {
  unknown_session: "Le projet ne garde aucune session de ce nom.",
  invalid_request: "La demande n’est pas valide : dites aux agents quoi tester.",
  session_running: "La session est de nouveau en cours : envoyez-lui votre message comme à une session qui travaille.",
  session_ended: "La session vient de se terminer : il n’y a plus rien à arrêter, et votre message, envoyé de nouveau, la poursuit.",
  unavailable: "Aucune source de sessions n’est configurée sur cette instance.",
  not_opened: "La session n’a pas pu être ouverte.",
  opening_timed_out: "L’ouverture de la session a pris trop de temps : réessayez dans un instant.",
  stale_revision: "La configuration a changé depuis que vous l’avez ouverte : relisez-la, puis refaites votre modification.",
  configuration_conflict: "oqas.json a changé depuis la dernière synchronisation : gardez le fichier, ou gardez vos modifications.",
  invalid_configuration: "La configuration n’est pas valide : corrigez les champs signalés.",
  no_configuration: "L’instance n’a pas encore de configuration.",
};

/** What the console says of a problem that has neither a wording here nor a detail. */
const UNEXPLAINED = "L’instance a rencontré une erreur.";

/**
 * Reads the code of a problem.
 *
 * @param code - What the answer carries as its code, if anything.
 * @returns The code when the console knows it; `error` for none, and for one a later version of the API added.
 */
export function problemCode(code: unknown): ProblemCode {
  return typeof code === "string" && Object.hasOwn(WORDINGS, code) ? (code as ProblemCode) : "error";
}

/**
 * Words a problem for the person.
 *
 * @param code - The code of the problem.
 * @param detail - What the API says went wrong, when it says it.
 * @returns The wording of the console for a code it knows, the detail of the API otherwise, or a sentence that
 * says no more than that the instance failed.
 */
export function problemText(code: ProblemCode, detail: unknown): string {
  if (code !== "error") return WORDINGS[code];
  return typeof detail === "string" && detail !== "" ? detail : UNEXPLAINED;
}
