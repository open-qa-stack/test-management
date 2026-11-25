import type { Session } from "@open-qa-stack/domain/sessions";
import { UsageError } from "../errors/usage-error.ts";

/**
 * Finds the session a person names: by its identifier, or by the start or the end of it when no other
 * session shares that — an identifier ends with a few characters that tell it from the others.
 *
 * @param sessions - Every session.
 * @param reference - What the person gave.
 * @returns The session.
 * @throws {@link UsageError} when it names no session, or more than one.
 */
export function referredSession(sessions: readonly Session[], reference: string): Session {
  const exact = sessions.find((session) => session.id === reference);
  if (exact !== undefined) return exact;
  const matching = sessions.filter(({ id }) => id.startsWith(reference) || id.endsWith(reference));
  const [only] = matching;
  if (only === undefined) throw new UsageError(`No session ${reference}; oqas sessions lists them.`);
  if (matching.length > 1)
    throw new UsageError(`${reference} names ${matching.length} sessions: ${matching.map(({ id }) => id).join(", ")}. Give more of the identifier.`);
  return only;
}
