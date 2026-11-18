import { hasEnded } from "@open-qa-stack/domain/sessions";
import type { ConversationState } from "./conversation-state.ts";

/** What the input asks for, by where the conversation is, and the keys that matter there. */
export interface KeyHints {
  /** What the empty input says. */
  readonly placeholder: string;
  /** The keys, each with what it does. */
  readonly keys: readonly string[];
}

/**
 * Says what the person may do now.
 *
 * @param state - The conversation.
 * @returns What the input asks for and the keys that matter: those of the list or the confirmation that stands
 * over it; while the session on screen goes on, that Enter speaks to its agents, and that Ctrl-C stops it when
 * this process runs it; once it ended, that Enter goes on with it, and `/new` opens another; otherwise that Enter
 * opens a session.
 */
export function hintsOf(state: ConversationState): KeyHints {
  const { overlay, shown } = state;
  if (overlay?.kind === "picker") return { placeholder: "", keys: ["Up/Down select", "Enter open", "Esc close"] };
  if (overlay?.kind === "stop") return { placeholder: "", keys: ["Enter stop it", "Esc keep it going"] };
  if (shown !== undefined && !hasEnded(shown.session.state)) {
    const stops = state.hosted.includes(shown.session.id);
    return { placeholder: "Say something to the agents", keys: ["Enter send", "/ commands", stops ? "Ctrl-C stop" : "Ctrl-C quit"] };
  }
  if (shown !== undefined) return { placeholder: "What do the agents do next?", keys: ["Enter go on", "/new another session", "Ctrl-C quit"] };
  return { placeholder: "What do we test?", keys: ["Enter open a session", "/ commands", "Ctrl-C quit"] };
}
