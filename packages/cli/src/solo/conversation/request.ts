import { hasEnded, type Session } from "@open-qa-stack/domain/sessions";
import { UI_PORT } from "../arguments.ts";
import { hintedCommands } from "./slash-commands.ts";
import type { ConversationState } from "./conversation-state.ts";
import { t } from "./i18n/i18n.ts";

/** A port `/ui` may be given: an integer from 0 to 65535. */
const PORT = /^[0-9]{1,5}$/;

/**
 * What the person asks when they press Enter, read from the conversation as it is: to open a session, to say
 * something to the one on screen, to resume it once it ended, one of the commands, the answer to what stands over
 * the input — or nothing, or something the conversation refuses, with why.
 */
export type Request =
  | { readonly kind: "nothing" }
  | { readonly kind: "open"; readonly request: string }
  | { readonly kind: "say"; readonly session: string; readonly text: string }
  | { readonly kind: "resume"; readonly session: string; readonly text: string }
  | { readonly kind: "pick"; readonly session: Session }
  | { readonly kind: "stop"; readonly session: string }
  | { readonly kind: "confirm-stop"; readonly session: string }
  | { readonly kind: "sessions" }
  | { readonly kind: "new" }
  | { readonly kind: "ui"; readonly port: number }
  | { readonly kind: "model" }
  | { readonly kind: "help" }
  | { readonly kind: "quit" }
  | { readonly kind: "refused"; readonly why: string };

/** What a line that starts with a slash asks: the command it names, by its name or by the start of it when no other shares it. */
function commandOf(state: ConversationState, line: string): Request {
  const [word = "", ...rest] = line.split(/\s+/);
  const named = hintedCommands(word);
  const [command] = named.filter(({ name }) => named.length === 1 || name === word.slice(1));
  if (command === undefined) return { kind: "refused", why: t("requests.unknown", { word }) };
  const [value, ...more] = rest;
  if (value !== undefined && (command.name !== "ui" || more.length > 0))
    return { kind: "refused", why: t("requests.takes", { name: command.name, what: command.takes ?? t("requests.nothingAfter") }) };
  switch (command.name) {
    case "stop": {
      const session = state.shown?.session;
      return session === undefined || hasEnded(session.state) ? { kind: "refused", why: t("requests.nothingToStop") } : { kind: "stop", session: session.id };
    }
    case "ui":
      if (value === undefined) return { kind: "ui", port: UI_PORT };
      return PORT.test(value) && Number(value) <= 65535 ? { kind: "ui", port: Number(value) } : { kind: "refused", why: t("requests.port") };
    default:
      return { kind: command.name };
  }
}

/**
 * Reads what the person asks by pressing Enter.
 *
 * @param state - The conversation.
 * @returns The answer to what stands over the input when something does: the session the picker has selected,
 * or the stop that is confirmed. Otherwise what the input holds: nothing when it is empty, a command when it
 * starts with a slash, something said to the session on screen while it goes on, what resumes it for a new turn
 * once it ended, and what to test in a new session when no session is on screen.
 */
export function requestOf(state: ConversationState): Request {
  const { overlay, shown } = state;
  if (overlay?.kind === "stop") return { kind: "confirm-stop", session: overlay.session };
  if (overlay?.kind === "picker") {
    const session = overlay.sessions[overlay.selected];
    return session === undefined ? { kind: "nothing" } : { kind: "pick", session };
  }
  const line = state.input.trim();
  if (line === "") return { kind: "nothing" };
  if (line.startsWith("/")) return commandOf(state, line);
  if (shown === undefined) return { kind: "open", request: line };
  return { kind: hasEnded(shown.session.state) ? "resume" : "say", session: shown.session.id, text: line };
}
