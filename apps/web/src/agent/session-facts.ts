import type { Session } from "@open-qa-stack/domain/sessions";
import { counted } from "../ui/counted.ts";
import type { BadgeTone } from "../ui/badge.tsx";

/** How the state of a session reads, and its colour family. */
export interface StateLabel {
  readonly tone: BadgeTone;
  readonly label: string;
}

/** How a session that ended reads when nothing tells how, or tells it in a way this console does not know. */
const ENDED: StateLabel = { tone: "neutral", label: "terminée" };

/** How each way a session ended reads; a later version of the API may tell another. */
const OUTCOMES: Readonly<Record<string, StateLabel>> = {
  passed: { tone: "ok", label: "tests réussis" },
  failed: { tone: "ko", label: "test en échec" },
  inconclusive: { tone: "warn", label: "test sans verdict" },
  stopped: { tone: "neutral", label: "arrêtée avant la fin" },
};

/**
 * Reads the state of a session.
 *
 * @param session - The session.
 * @returns `en file` while it waits its turn, in the tone of what has not started, `en direct` while its
 * agents work, `interrompue` when it stopped without ending; otherwise how it ended, or `terminée` when nothing tells it: a state this console does not know is one of a session that no
 * longer goes on.
 */
export function stateOf(session: Session): StateLabel {
  if (session.state === "queued") return { tone: "outline", label: "en file" };
  if (session.state === "running") return { tone: "info", label: "en direct" };
  if (session.state === "interrupted") return { tone: "warn", label: "interrompue" };
  return (session.result === undefined ? undefined : OUTCOMES[session.result.outcome]) ?? ENDED;
}

/**
 * Writes a duration as a person reads it.
 *
 * @param milliseconds - The duration.
 * @returns It in seconds under a minute, in minutes and seconds beyond.
 */
export function durationText(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
}

/**
 * Writes when a session was opened.
 *
 * @param session - The session.
 * @returns Its day and its time, in universal time.
 */
export function openingText(session: Session): string {
  return `${session.openedAt.slice(0, 10)} · ${session.openedAt.slice(11, 19)} UTC`;
}

/**
 * Says what a session waits for.
 *
 * @param session - The session.
 * @returns That it waits for an agent while it is queued, or nothing: a state alone does not tell a person
 * why nothing moves.
 */
export function waitText(session: Session): string | undefined {
  return session.state === "queued" ? "en attente d’un agent" : undefined;
}

/**
 * Counts the tests of a session by verdict.
 *
 * @param session - The session.
 * @returns How many passed out of how many, or nothing when it has none.
 */
export function testsText(session: Session): string | undefined {
  const tests = session.result?.tests ?? [];
  if (tests.length === 0) return undefined;
  return `${tests.filter(({ verdict }) => verdict === "passed").length} / ${counted(tests.length, "test réussi", "tests réussis")}`;
}

/**
 * Writes how long an action took.
 *
 * @param milliseconds - The duration.
 * @returns It in milliseconds under a second, in seconds with a decimal under a minute, as a duration beyond.
 */
export function elapsedText(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  return milliseconds < 60_000 ? `${(milliseconds / 1000).toFixed(1).replace(".", ",")} s` : durationText(milliseconds);
}
