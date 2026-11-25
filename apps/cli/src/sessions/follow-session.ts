import type { Sessions } from "@open-qa-stack/engine";
import type { ThreadOutput } from "../output/thread-output.ts";

/**
 * Follows a session to its end: each event of its thread is printed as it is told, from the first or after a rank.
 *
 * @param sessions - The operations on sessions.
 * @param id - The identifier of the session.
 * @param output - Where its thread is printed.
 * @param after - The rank of the last event not to print: that of the turns before the one followed; 0 for every event.
 * @returns Once the session ended, and its last event is printed.
 * @throws `UnknownSessionError` when there is no such session, and what the store raises when the events can no longer be read.
 */
export async function followSession(sessions: Sessions, id: string, output: ThreadOutput, after: number): Promise<void> {
  const events = await sessions.events(id, after);
  await new Promise<void>((ended, failed) => {
    events.subscribe({ event: (event) => output.event(event), ended, failed });
  });
}
