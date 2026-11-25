import type { Session } from "@open-qa-stack/domain/sessions";
import { i18n, t } from "../i18n/i18n.ts";

/** The ways a session ended the terminal words; a later version of the contract may tell another. */
const OUTCOMES = new Set(["passed", "failed", "inconclusive", "stopped"]);

/** The states of a session the terminal words; a later version of the contract may tell another. */
const STATES = new Set(["queued", "running", "interrupted", "completed"]);

/**
 * Says the state of a session in a word.
 *
 * @param state - The state, as the contract names it.
 * @returns It in the words of the conversation; a state the command does not know as it is.
 */
export function stateText(state: string): string {
  return STATES.has(state) ? t(`facts.states.${state as "queued" | "running" | "interrupted" | "completed"}`) : state;
}

/**
 * Says how a session stands, in a word or two.
 *
 * @param session - The session.
 * @returns `queued` while it waits its turn, `running` while its agents work, `interrupted` when it stopped
 * without ending; otherwise how it ended, or `ended` when nothing tells it: a state the command does not know
 * is one of a session that no longer goes on.
 */
export function standing(session: Session): string {
  if (session.state === "queued" || session.state === "running" || session.state === "interrupted") return stateText(session.state);
  const outcome = session.result?.outcome;
  return outcome !== undefined && OUTCOMES.has(outcome)
    ? t(`facts.outcomes.${outcome as "passed" | "failed" | "inconclusive" | "stopped"}`)
    : t("facts.states.ended");
}

/**
 * Writes a duration as a person reads it.
 *
 * @param milliseconds - The duration.
 * @returns It in milliseconds under a second, in seconds with a decimal under a minute — written as the language of
 * the conversation writes it —, in minutes and seconds beyond.
 */
export function elapsedText(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds >= 60_000) return sinceText(milliseconds);
  return `${new Intl.NumberFormat(i18n.resolvedLanguage, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(milliseconds / 1000)} s`;
}

/**
 * Writes how long something has been going on, as a clock that moves by the second tells it.
 *
 * @param milliseconds - The duration.
 * @returns It in whole seconds under a minute, in minutes and seconds beyond.
 */
export function sinceText(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
}
