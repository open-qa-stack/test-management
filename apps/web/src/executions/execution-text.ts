import type { Execution, Session } from "@open-qa-stack/domain/sessions";
import { durationText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";

/**
 * How long the tests of an execution took together.
 *
 * @param execution - The execution.
 * @returns The duration, in the words of the person.
 */
export function executionDuration(execution: Pick<Execution, "results">): string {
  return durationText(execution.results.reduce((sum, result) => sum + result.durationMs, 0));
}

/**
 * The version of the test repository an execution ran at.
 *
 * @param execution - The execution.
 * @returns The short commit; a dash for an execution that kept none.
 */
export function versionText(execution: Pick<Execution, "commit">): string {
  return execution.commit === undefined ? "—" : execution.commit.slice(0, 7);
}

/**
 * The session that ran an execution, among those the console knows.
 *
 * @param execution - The execution.
 * @param sessions - The sessions of the project the console listed.
 * @returns What was asked of it; `undefined` for an execution no known session ran.
 */
export function requestOf(execution: Pick<Execution, "sessionId">, sessions: readonly Session[]): string | undefined {
  return sessions.find((session) => session.id === execution.sessionId)?.request;
}

/**
 * What an execution ran, in a few words: the session that asked for it, or how many tests it ran.
 *
 * @param execution - The execution.
 * @param sessions - The sessions of the project the console listed.
 * @returns The words.
 */
export function contentText(execution: Execution, sessions: readonly Session[]): string {
  const request = requestOf(execution, sessions);
  return request === undefined ? t("executions.tests", { count: execution.results.length }) : t("executions.session", { request });
}
