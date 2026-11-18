import type { Session } from "@open-qa-stack/domain/sessions";

/** How each way a session ended reads; a later version of the contract may tell another. */
const OUTCOMES: Readonly<Record<string, string>> = {
  passed: "tests passed",
  failed: "a test failed",
  inconclusive: "a test has no verdict",
  stopped: "stopped before the end",
};

/**
 * Says how a session stands, in a word or two.
 *
 * @param session - The session.
 * @returns `queued` while it waits its turn, `running` while its agents work, `interrupted` when it stopped
 * without ending; otherwise how it ended, or `ended` when nothing tells it: a state the command does not know
 * is one of a session that no longer goes on.
 */
export function standing(session: Session): string {
  if (session.state === "queued" || session.state === "running" || session.state === "interrupted") return session.state;
  return (session.result === undefined ? undefined : OUTCOMES[session.result.outcome]) ?? "ended";
}

/**
 * Writes a duration as a person reads it.
 *
 * @param milliseconds - The duration.
 * @returns It in milliseconds under a second, in seconds with a decimal under a minute, in minutes and seconds beyond.
 */
export function elapsedText(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  return milliseconds < 60_000 ? `${(milliseconds / 1000).toFixed(1)} s` : sinceText(milliseconds);
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
