import { scriptOf as scriptIn, type ScriptWording, type Session, type SessionEvent, type SessionScript } from "@open-qa-stack/domain/sessions";
import { momentText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { levelName, phaseName } from "../i18n/vocabulary.ts";
import { toolTitle } from "./tool-title.ts";

/** The words of the console for what a thread tells, in its language now; a phase it does not know reads as a step of the work, without more. */
function wording(): ScriptWording {
  return {
    phase: phaseName,
    level: levelName,
    tool: toolTitle,
    planAccepted: t("steps.planAccepted"),
    scope: t("steps.scope"),
    interrupted: t("steps.interrupted"),
    verdicts: (tests) => t("steps.verdicts", { count: tests }),
    closed: (scenarios) => t("steps.closed", { count: scenarios }),
    opened: (day, time) => t("steps.opened", { moment: momentText(`${day}T${time}Z`) }),
  };
}

/**
 * Reads the events of a session as the steps its thread shows, in the words of the console.
 *
 * @param session - The session, as the API last told it.
 * @param events - Its events, in order.
 * @returns The steps, with the title of the session: what was asked to open it, or when it was opened.
 */
export function scriptOf(session: Session, events: readonly SessionEvent[]): SessionScript {
  return scriptIn(session, events, wording());
}
