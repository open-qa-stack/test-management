import type { Session } from "@open-qa-stack/domain/sessions";

/** How a session stands, in a word or two: its state, and how it ended once it is completed. */
function standing({ state, result }: Session): string {
  return result === undefined ? state : `${state}, ${result.outcome}`;
}

/**
 * Writes a session as one line of the list of the sessions.
 *
 * @param session - The session.
 * @returns Its identifier, how it stands, when it was opened and what was asked, without the end of the line.
 */
export function listedLine(session: Session): string {
  const asked = session.request === undefined ? "" : `  ${session.request.replace(/\s+/g, " ").trim()}`;
  return `${session.id}  ${standing(session)}  ${session.openedAt}${asked}`;
}

/**
 * Writes what a session came to, as the summary a person reads once it is over or when it is shown.
 *
 * @param session - The session.
 * @returns The lines, without their ends: how the session stands, what it took and the branch of its tests
 * once it is completed, then the verdict of each test.
 */
export function summaryLines(session: Session): string[] {
  const { id, result } = session;
  if (result === undefined) return [`Session ${id}: ${standing(session)}.`];
  return [
    `Session ${id}: ${standing(session)}, in ${Math.round(result.durationMs / 100) / 10} s and ${result.modelRequests} model requests.`,
    ...(result.branch === undefined ? [] : [`Tests written on the branch ${result.branch}.`]),
    ...result.tests.map((test) => `${test.verdict.padEnd(13)} ${test.id}`),
  ];
}
