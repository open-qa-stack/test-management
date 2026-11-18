import { randomBytes } from "node:crypto";

/**
 * Names a session that is asked for.
 *
 * @remarks
 * The identifier starts with the date, so that identifiers sort in the order the sessions were asked for, and
 * ends with random characters, so that two sessions asked for in the same millisecond, by one process or by
 * two, differ. Clients read nothing in it: an identifier is only ever compared with another.
 *
 * @param at - When the session is asked for.
 * @returns The identifier, such as `session-2026-11-16T08-12-45-120Z-9f3a1c2b`.
 */
export function newSessionId(at: Date): string {
  return `session-${at.toISOString().replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}`;
}
