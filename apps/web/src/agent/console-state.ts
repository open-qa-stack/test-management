import type { Project, Session, SessionEvent } from "@open-qa-stack/shared/sessions";
import type { StreamState } from "../api/event-stream.ts";
import { INITIAL_PLAYBACK, played, type Playback, type PlaybackAction } from "./playback.ts";
import type { SessionScript } from "./session-script.ts";

/** The session the address opens: what the API told of it, and what its stream gave so far. */
export interface Followed {
  /** The identifier of the session. */
  readonly id: string;
  /** The session, once the console knows it: as the list had it on arrival, then as the API told it. */
  readonly session?: Session;
  /** Whether the instance said it keeps no session of that name. */
  readonly missing: boolean;
  /** Where its stream is. */
  readonly stream: StreamState;
  /** Its events, in order. */
  readonly events: readonly SessionEvent[];
}

/** Where the opening of a session is: nothing asked, the request sent, or the error the API answered. */
export type Opening = { readonly state: "idle" } | { readonly state: "sending" } | { readonly state: "refused"; readonly message: string };

/** What the console knows: what its instance told it, and how the person reads each session. */
export interface ConsoleState {
  /** The project; `undefined` before the API described it. */
  readonly project?: Project;
  /** The sessions of the project, the latest first; `undefined` before the API listed them. */
  readonly sessions?: readonly Session[];
  /** Why the API last failed to list the sessions, when it answered and failed. */
  readonly unlisted?: string;
  /** The rank, among the calls of the console, of the answer that last opened a session. */
  readonly openedAt: number;
  /** Whether the instance could not be reached when last called. */
  readonly unreachable: boolean;
  /** The session the address opens. */
  readonly followed?: Followed;
  /** Where the opening of a session is. */
  readonly opening: Opening;
  /** The playback of each session a person touched, by its identifier. */
  readonly playbacks: Readonly<Record<string, Playback>>;
}

/** What changes the state of the console. */
export type ConsoleAction =
  /** The API described the project. */
  | { readonly type: "project"; readonly project: Project }
  /** The API listed the sessions, asked at a rank among the calls of the console. */
  | { readonly type: "sessions"; readonly sessions: readonly Session[]; readonly askedAt: number }
  /** The API answered that it could not list the sessions. */
  | { readonly type: "unlisted"; readonly message: string }
  /** The instance could not be reached. */
  | { readonly type: "unreachable" }
  /** The console starts following a session. */
  | { readonly type: "followed"; readonly id: string }
  /** The API told a session. */
  | { readonly type: "session"; readonly session: Session }
  /** The API keeps no session of a name. */
  | { readonly type: "missing"; readonly id: string }
  /** The stream of a session changed state. */
  | { readonly type: "stream"; readonly id: string; readonly state: StreamState }
  /** The stream of a session gave events. */
  | { readonly type: "events"; readonly id: string; readonly events: readonly SessionEvent[] }
  /** The console left the session it followed. */
  | { readonly type: "left" }
  /** The person asked to open a session. */
  | { readonly type: "opening" }
  /** The API opened the session asked for; its answer came at a rank among the calls of the console. */
  | { readonly type: "opened"; readonly session: Session; readonly answeredAt: number }
  /** The API refused to open a session. */
  | { readonly type: "refused"; readonly message: string }
  /** The person acted on the playback of a session. */
  | { readonly type: "playback"; readonly script: SessionScript; readonly action: PlaybackAction };

/** The state of a console that just opened. */
export const INITIAL_STATE: ConsoleState = { openedAt: 0, unreachable: false, opening: { state: "idle" }, playbacks: {} };

/**
 * A session as the API tells it now, in the object the console already holds when nothing it shows differs:
 * what is drawn from a session is computed again only when the session changed.
 */
function settled(before: Session | undefined, now: Session): Session {
  const same =
    before !== undefined &&
    before.state === now.state &&
    before.lastEventAt === now.lastEventAt &&
    (before.result === undefined) === (now.result === undefined);
  return same ? before : now;
}

/** The sessions as the API lists them now, each in the object the console already holds when it did not change; the list itself when none did. */
function listed(before: readonly Session[] | undefined, now: readonly Session[]): readonly Session[] {
  if (before === undefined) return now;
  const byId = new Map(before.map((session) => [session.id, session]));
  const sessions = now.map((session) => settled(byId.get(session.id), session));
  return sessions.length === before.length && sessions.every((session, index) => session === before[index]) ? before : sessions;
}

/**
 * Applies an action to the state of the console.
 *
 * @param state - The state.
 * @param action - What happened.
 * @returns The state after it — the same object when nothing changed. What a stream or the API gives for a
 * session the console no longer follows changes nothing; an event already received is not kept twice; a session
 * that did not change keeps its object; an answer of the API says the instance is reachable again; a session
 * the API just opened is listed first, and a list asked before it was opened, which may lack it, is ignored.
 */
export function consoleAfter(state: ConsoleState, action: ConsoleAction): ConsoleState {
  switch (action.type) {
    case "project":
      return { ...state, project: action.project, unreachable: false };
    case "sessions": {
      if (action.askedAt < state.openedAt) return state;
      const sessions = listed(state.sessions, action.sessions);
      if (sessions === state.sessions && state.unlisted === undefined && !state.unreachable) return state;
      const { unlisted: _answered, ...rest } = state;
      return { ...rest, sessions, unreachable: false };
    }
    case "unlisted":
      return { ...state, unlisted: action.message, unreachable: false };
    case "unreachable":
      return state.unreachable ? state : { ...state, unreachable: true };
    case "followed": {
      const session = state.sessions?.find(({ id }) => id === action.id);
      return { ...state, followed: { id: action.id, missing: false, stream: "connecting", events: [], ...(session === undefined ? {} : { session }) } };
    }
    case "session": {
      const { followed } = state;
      if (followed?.id !== action.session.id) return state;
      const session = settled(followed.session, action.session);
      if (session === followed.session && !state.unreachable) return state;
      return { ...state, unreachable: false, followed: { ...followed, session } };
    }
    case "missing":
      return state.followed?.id === action.id ? { ...state, unreachable: false, followed: { ...state.followed, missing: true } } : state;
    case "stream":
      return state.followed?.id === action.id ? { ...state, followed: { ...state.followed, stream: action.state } } : state;
    case "events": {
      const { followed } = state;
      if (followed?.id !== action.id) return state;
      const last = followed.events.at(-1)?.id ?? 0;
      const fresh = action.events.filter((event) => event.id > last);
      return fresh.length === 0 ? state : { ...state, followed: { ...followed, events: followed.events.concat(fresh) } };
    }
    case "left": {
      const { followed: _left, ...rest } = state;
      return rest;
    }
    case "opening":
      return { ...state, opening: { state: "sending" } };
    case "opened":
      return {
        ...state,
        opening: { state: "idle" },
        openedAt: action.answeredAt,
        unreachable: false,
        sessions: [action.session, ...(state.sessions ?? []).filter((session) => session.id !== action.session.id)],
      };
    case "refused":
      return { ...state, opening: { state: "refused", message: action.message } };
    case "playback": {
      const { script } = action;
      return { ...state, playbacks: { ...state.playbacks, [script.id]: played(script, playbackOf(state, script.id), action.action) } };
    }
  }
}

/**
 * The playback of a session.
 *
 * @param state - The state of the console.
 * @param id - The identifier of the session.
 * @returns Its playback; the one of a session just opened when the person never touched it.
 */
export function playbackOf(state: ConsoleState, id: string): Playback {
  return state.playbacks[id] ?? INITIAL_PLAYBACK;
}
