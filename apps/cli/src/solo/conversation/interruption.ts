import { hasEnded } from "@open-qa-stack/domain/sessions";
import type { ConversationState } from "./conversation-state.ts";

/**
 * What Ctrl-C does, by where the conversation is: it closes what stands over the input, clears what the input
 * holds, leaves when it was just pressed, asks the session on screen to stop when this process runs it and it
 * goes on, and otherwise arms itself, so that pressing it again leaves.
 */
export type Interruption =
  | { readonly kind: "dismiss" | "clear" | "leave" | "arm" }
  /** The session to ask to stop. */
  | { readonly kind: "stop"; readonly session: string };

/**
 * Reads what Ctrl-C does.
 *
 * @remarks
 * A first Ctrl-C never leaves, and stops no session but the one the person reads and this process runs, as it
 * does for `oqas --brief`: a session another process runs is left to it, as `oqas attach` leaves it.
 *
 * @param state - The conversation.
 * @returns What the key does.
 */
export function interruptionOf(state: ConversationState): Interruption {
  if (state.overlay !== undefined) return { kind: "dismiss" };
  if (state.input !== "") return { kind: "clear" };
  if (state.armed) return { kind: "leave" };
  const session = state.shown?.session;
  return session !== undefined && !hasEnded(session.state) && state.hosted.includes(session.id) ? { kind: "stop", session: session.id } : { kind: "arm" };
}
