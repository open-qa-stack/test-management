import { hasEnded } from "@open-qa-stack/domain/sessions";
import type { ConversationState } from "./conversation-state.ts";
import { t } from "./i18n/i18n.ts";

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
  if (overlay?.kind === "picker") return { placeholder: "", keys: [t("hints.picker.move"), t("hints.picker.open"), t("hints.close")] };
  if (overlay?.kind === "stop") return { placeholder: "", keys: [t("hints.stop.confirm"), t("hints.stop.keep")] };
  // The setting of the model, and the typing of a value, say their own keys.
  if (overlay?.kind === "model" || overlay?.kind === "secret") return { placeholder: "", keys: [] };
  if (shown !== undefined && !hasEnded(shown.session.state)) {
    const stops = state.hosted.includes(shown.session.id);
    return { placeholder: t("hints.say"), keys: [t("hints.send"), t("hints.commands"), t(stops ? "hints.ctrlCStop" : "hints.ctrlCQuit")] };
  }
  if (shown !== undefined) return { placeholder: t("hints.next"), keys: [t("hints.goOn"), t("hints.another"), t("hints.ctrlCQuit")] };
  return { placeholder: t("hints.what"), keys: [t("hints.open"), t("hints.commands"), t("hints.ctrlCQuit")] };
}
