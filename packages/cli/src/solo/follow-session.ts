import type { Sessions } from "@open-qa-stack/engine";
import type { ThreadOutput } from "./thread-output.ts";

/**
 * Follows a session to its end: each event of its thread is printed as it is told, from the first.
 *
 * @param sessions - The operations on sessions.
 * @param id - The identifier of the session.
 * @param output - Where its thread is printed.
 * @returns Once the session ended, and its last event is printed.
 * @throws `UnknownSessionError` when there is no such session, and what the store raises when the events can no longer be read.
 */
export async function followSession(sessions: Sessions, id: string, output: ThreadOutput): Promise<void> {
  const events = await sessions.events(id, 0);
  await new Promise<void>((ended, failed) => {
    events.subscribe({ event: (event) => output.event(event), ended, failed });
  });
}
