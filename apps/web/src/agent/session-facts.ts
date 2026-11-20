import type { Session } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import type { BadgeTone } from "../ui/badge.tsx";

/** How the state of a session reads, and its colour family. */
export interface StateLabel {
  readonly tone: BadgeTone;
  readonly label: string;
}

/** The colour family of each way a session ended; a later version of the API may tell another. */
const OUTCOMES: Readonly<Record<string, readonly [BadgeTone, "passed" | "failed" | "inconclusive" | "stopped"]>> = {
  passed: ["ok", "passed"],
  failed: ["ko", "failed"],
  inconclusive: ["warn", "inconclusive"],
  stopped: ["neutral", "stopped"],
};

/**
 * Reads the state of a session.
 *
 * @param session - The session.
 * @returns `queued` while it waits its turn, in the tone of what has not started, `live` while its agents work,
 * `interrupted` when it stopped without ending; otherwise how it ended, or `ended` when nothing tells it: a state
 * this console does not know is one of a session that no longer goes on.
 */
export function stateOf(session: Session): StateLabel {
  if (session.state === "queued") return { tone: "outline", label: t("facts.states.queued") };
  if (session.state === "running") return { tone: "info", label: t("facts.states.running") };
  if (session.state === "interrupted") return { tone: "warn", label: t("facts.states.interrupted") };
  const outcome = session.result === undefined ? undefined : OUTCOMES[session.result.outcome];
  return outcome === undefined ? { tone: "neutral", label: t("facts.states.ended") } : { tone: outcome[0], label: t(`facts.outcomes.${outcome[1]}`) };
}

/**
 * Says what a session waits for.
 *
 * @param session - The session.
 * @returns That it waits for an agent while it is queued, or nothing: a state alone does not tell a person
 * why nothing moves.
 */
export function waitText(session: Session): string | undefined {
  return session.state === "queued" ? t("facts.waiting") : undefined;
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
  return t("facts.testsPassed", { passed: tests.filter(({ verdict }) => verdict === "passed").length, count: tests.length });
}

/**
 * Says what of the project a session keeps its work to: its applications, its domains and its levels, those it names.
 *
 * @param session - The session.
 * @returns The scope in a few words; nothing for a session of the whole project.
 */
export function scopeText(session: Session): string | undefined {
  const { applications = [], domains = [], levels = [] } = session.scope ?? {};
  const words = [...applications, ...domains, ...levels.map((level) => t(`sessionScope.levelNames.${level}`))];
  return words.length === 0 ? undefined : t("facts.scope", { scope: words.join(", ") });
}
