import { hasEnded, scriptOf, type Session, type SessionEvent } from "@open-qa-stack/domain/sessions";
import { PICKED_SESSIONS, RECENT_SESSIONS, type ConversationState, type Printed, type ShownThread } from "./conversation-state.ts";
import { interruptionOf } from "./interruption.ts";
import { hintedCommands } from "./slash-commands.ts";
import { blocksOf, settledCount } from "../blocks/thread-blocks.ts";
import { wording } from "../blocks/wording.ts";
import type { Model } from "@open-qa-stack/domain/sessions";
import { reachText, type SetupEnd } from "../setup/model-setup/model-setup.ts";
import type { SecretEnd } from "../setup/secret-entry.ts";
import type { Request } from "./request.ts";
import { t } from "../i18n/i18n.ts";

/** What changes the conversation: a key of the person, or what the operations on sessions answered. */
export type ConversationAction =
  /** The person typed in the input, which now holds this. */
  | { readonly type: "typed"; readonly input: string }
  /** The person pressed Tab: the command they are typing is completed. */
  | { readonly type: "completed" }
  /** The person pressed an arrow: the selection of the picker moves. */
  | { readonly type: "moved"; readonly by: 1 | -1 }
  /** The person pressed Esc: what stands over the input closes. */
  | { readonly type: "dismissed" }
  /** The person pressed Ctrl-C. */
  | { readonly type: "interrupted" }
  /** The person pressed Enter, which asked this. */
  | { readonly type: "submitted"; readonly request: Request }
  /** A thread comes on screen: that of a session just opened here, which this process runs, or of one picked. */
  | { readonly type: "opened"; readonly session: Session; readonly hosted: boolean }
  /** The session on screen was resumed here for a new turn, which this process runs. */
  | { readonly type: "resumed"; readonly session: Session }
  /** The session on screen told events. */
  | { readonly type: "told"; readonly session: string; readonly events: readonly SessionEvent[] }
  /** The session on screen ended: this is what it came to. */
  | { readonly type: "ended"; readonly session: Session }
  /** The sessions were listed, to pick one from. */
  | { readonly type: "listed"; readonly sessions: readonly Session[] }
  /** The person went back to the start, where these are the latest sessions. */
  | { readonly type: "restarted"; readonly sessions: readonly Session[] }
  /** The web console is served at this address. */
  | { readonly type: "served"; readonly url: string }
  /** Something the person asked failed, or was refused: this says why, and what to do. */
  | { readonly type: "failed"; readonly why: string }
  /** A command run after a slash ended, having written this. */
  | { readonly type: "ran"; readonly text: string; readonly failed: boolean }
  /** The clock moved. */
  | { readonly type: "ticked"; readonly now: number }
  /** The connection in force was read: its setting opens over the input. */
  | { readonly type: "model-opened"; readonly inForce: Model }
  /** The setting of the connection ended. */
  | { readonly type: "model-ended"; readonly end: SetupEnd }
  /** The typing of the value of a variable ended. */
  | { readonly type: "secret-ended"; readonly end: SecretEnd }
  /** The model in force does not answer, for the reason given. */
  | { readonly type: "model-silent"; readonly why: string };

/** The conversation without what the last key told, and with Ctrl-C disarmed: what a key, or the end of a session, leaves of it whatever comes next. */
function afterKey(state: ConversationState): ConversationState {
  const { notice: _told, ...rest } = state;
  return { ...rest, armed: false };
}

/** The conversation without what stood over its input. */
function withoutOverlay(state: ConversationState): ConversationState {
  const { overlay: _closed, ...rest } = state;
  return rest;
}

/** The conversation with its input set by something else than the keys typed in it. */
function withInput(state: ConversationState, input: string): ConversationState {
  return { ...state, input, inputEpoch: state.inputEpoch + 1 };
}

/** The conversation with something written to its scrollback. */
function printing(state: ConversationState, ...printed: readonly Printed[]): ConversationState {
  return { ...state, printed: [...state.printed, ...printed] };
}

/**
 * Writes for good the blocks of the thread on screen that have settled since the last time.
 *
 * @param state - The conversation.
 * @param shown - Its thread, as it is now.
 * @returns The conversation with that thread, the blocks that will not change any more written to the scrollback.
 */
function settling(state: ConversationState, shown: ShownThread): ConversationState {
  const script = scriptOf(shown.session, shown.events, wording());
  const blocks = blocksOf(script.steps);
  const settled = Math.max(shown.settled, settledCount(blocks, script.stage !== "ended"));
  return {
    ...printing(state, ...blocks.slice(shown.settled, settled).map((block): Printed => ({ kind: "block", block }))),
    shown: { ...shown, settled },
  };
}

/** The session on screen as its events tell it: `running` once they say it started. How it ended is told by the session itself, with its result. */
function sessionAfter(session: Session, events: readonly SessionEvent[]): Session {
  return events.reduce((told, event) => (event.type === "state_changed" && !hasEnded(event.state) ? { ...told, state: event.state } : told), session);
}

/** What pressing Enter does to the conversation itself; what it asks of the operations on sessions is done beside. */
function submitted(state: ConversationState, request: Request): ConversationState {
  const cleared = request.kind === "nothing" ? state : withInput(state, "");
  switch (request.kind) {
    case "stop":
      return { ...cleared, overlay: { kind: "stop", session: request.session } };
    case "secret":
      return { ...cleared, overlay: { kind: "secret", variable: request.variable } };
    case "confirm-stop":
      return { ...withoutOverlay(cleared), notice: t("notices.stopAsked") };
    case "pick":
      return withoutOverlay(cleared);
    case "help":
      return printing(cleared, { kind: "help" });
    case "quit":
      return { ...cleared, leaving: { atOnce: false } };
    case "refused":
      return { ...cleared, notice: request.why };
    default:
      return cleared;
  }
}

/** What Ctrl-C does to the conversation itself; the stop it may ask of a session is asked beside. */
function interrupted(state: ConversationState): ConversationState {
  switch (interruptionOf(state).kind) {
    case "dismiss":
      return withoutOverlay(state);
    case "clear":
      return withInput(state, "");
    case "leave":
      return { ...state, leaving: { atOnce: true } };
    case "stop":
      return { ...state, armed: true, notice: t("notices.ctrlCStops") };
    case "arm":
      return { ...state, armed: true, notice: t("notices.ctrlCLeaves") };
  }
}

/**
 * Gives the conversation after something happened.
 *
 * @remarks
 * The reducer is the whole behaviour of the screen, and does nothing else: it calls no operation and reads no
 * clock. Whoever dispatches an action does what the action asks of the world — open, say, interrupt — and
 * comes back with what the world answered, as another action.
 *
 * The scrollback only grows: a block of the thread is written to it once it will not change, and what may
 * still change — an action whose tool has not answered, a message no agent took yet — stays on the live part
 * of the screen until it settles.
 *
 * @param state - The conversation.
 * @param action - What happened.
 * @returns The conversation after it.
 */
export function conversationReducer(state: ConversationState, action: ConversationAction): ConversationState {
  switch (action.type) {
    case "typed":
      return { ...afterKey(state), input: action.input };
    case "completed": {
      const [command] = hintedCommands(state.input);
      return command === undefined ? state : withInput(afterKey(state), `/${command.name}${command.takes === undefined ? "" : " "}`);
    }
    case "moved": {
      const { overlay } = state;
      if (overlay?.kind !== "picker") return state;
      const selected = (overlay.selected + action.by + overlay.sessions.length) % overlay.sessions.length;
      return { ...state, overlay: { ...overlay, selected } };
    }
    case "dismissed":
      return withoutOverlay(afterKey(state));
    case "interrupted":
      return interrupted(state);
    case "submitted":
      return submitted(afterKey(state), action.request);
    case "opened": {
      // A thread that is on screen already stays as it is, and goes on being followed.
      if (state.shown?.session.id === action.session.id) return state;
      const hosted = action.hosted ? [...state.hosted, action.session.id] : state.hosted;
      return {
        ...printing(state, { kind: "heading", session: action.session }),
        hosted,
        shown: { session: action.session, events: [], settled: 0, resumed: 0 },
      };
    }
    case "resumed": {
      const { shown } = state;
      if (shown === undefined || shown.session.id !== action.session.id) return state;
      const hosted = state.hosted.includes(action.session.id) ? state.hosted : [...state.hosted, action.session.id];
      return { ...state, hosted, shown: { ...shown, session: action.session, resumed: shown.resumed + 1 } };
    }
    case "told": {
      const { shown } = state;
      if (shown === undefined || shown.session.id !== action.session) return state;
      return settling(state, { ...shown, session: sessionAfter(shown.session, action.events), events: [...shown.events, ...action.events] });
    }
    case "ended": {
      const { shown } = state;
      if (shown === undefined || shown.session.id !== action.session.id) return state;
      // What a key said of the session — that it was asked to stop — no longer holds once it ended.
      return printing(settling(afterKey(state), { ...shown, session: action.session }), { kind: "result", session: action.session });
    }
    case "listed":
      return action.sessions.length === 0
        ? { ...state, notice: t("notices.noSession") }
        : { ...state, overlay: { kind: "picker", sessions: action.sessions.slice(0, PICKED_SESSIONS), selected: 0 } };
    case "restarted": {
      const { shown: _left, ...rest } = state;
      return printing(rest, { kind: "recent", sessions: action.sessions.slice(0, RECENT_SESSIONS) });
    }
    case "served":
      return printing(state, { kind: "notice", tone: "info", text: t("notices.served", { url: action.url }) });
    case "failed":
      return printing(state, { kind: "notice", tone: "error", text: action.why });
    case "ran":
      return printing(state, { kind: "output", text: action.text, failed: action.failed });
    case "ticked":
      return { ...state, now: action.now };
    case "model-opened":
      return { ...afterKey(state), overlay: { kind: "model", inForce: action.inForce } };
    case "model-ended": {
      const closed = withoutOverlay(state);
      const { saved, error } = action.end;
      if (error !== undefined) return printing(closed, { kind: "notice", tone: "error", text: error });
      if (saved === undefined) return { ...closed, notice: t("model.left") };
      return printing(closed, { kind: "notice", tone: "info", text: t("model.set", { model: saved.model, reach: reachText(saved) }) });
    }
    case "secret-ended": {
      const closed = withoutOverlay(state);
      const { variable, saved, error } = action.end;
      if (error !== undefined) return printing(closed, { kind: "notice", tone: "error", text: error });
      if (!saved) return { ...closed, notice: t("secret.left") };
      return printing(closed, { kind: "notice", tone: "info", text: t("secret.saved", { variable }) });
    }
    case "model-silent":
      return printing(state, { kind: "notice", tone: "error", text: t("model.silent", { why: action.why }) });
  }
}
