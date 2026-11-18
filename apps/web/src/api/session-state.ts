import type { SessionState } from "@open-qa-stack/domain/sessions";

/**
 * Tells whether a session no longer goes on.
 *
 * @param state - Its state.
 * @returns Whether nothing more will come of it: it has not ended while it waits its turn or while its
 * agents work, and has in any other state — one this console does not know is one of a session that ended, so
 * that a later version of the API never leaves a stream open or a composer offered for good.
 */
export function hasEnded(state: SessionState): boolean {
  return state !== "queued" && state !== "running";
}
