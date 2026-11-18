import { scriptOf as scriptIn, type ScriptWording, type Session, type SessionEvent, type SessionScript } from "@open-qa-stack/domain/sessions";
import { toolTitle } from "./tool-title.ts";

/** How the start of each phase reads; a later version of the API may name another. */
const PHASES: Readonly<Record<string, string>> = {
  configuration: "Configuration",
  prerequisites: "Prérequis",
  survey: "Cartographie · sources",
  card: "Cartographie · fiche",
  consolidation: "Cartographie · domaines",
  index: "Cartographie · index",
  plan: "Plan",
  review: "Relecture du plan",
  write: "Écriture d’un test",
  execution: "Exécution des tests",
  summary: "Bilan",
};

/** The words of the console for what a thread tells; a phase it does not know reads as a step of the work, without more. */
const WORDING: ScriptWording = {
  phase: (phase) => PHASES[phase] ?? "Étape",
  tool: toolTitle,
  planAccepted: "Plan accepté par le harnais",
  interrupted: "La session s’est arrêtée sans aller à son terme.",
  verdicts: (tests) => `Verdict de l’exécution : ${tests} test(s)`,
  closed: (scenarios) => `${scenarios} test(s) clos par le harnais`,
  opened: (day, time) => `Session du ${day} à ${time} UTC`,
};

/**
 * Reads the events of a session as the steps its thread shows, in the words of the console.
 *
 * @param session - The session, as the API last told it.
 * @param events - Its events, in order.
 * @returns The steps, with the title of the session: what was asked to open it, or when it was opened.
 */
export function scriptOf(session: Session, events: readonly SessionEvent[]): SessionScript {
  return scriptIn(session, events, WORDING);
}
