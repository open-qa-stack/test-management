import type { Model, Session, SessionEvent } from "@open-qa-stack/domain/sessions";
import type { Block } from "./thread-blocks.ts";

/** How many sessions the start of the conversation recalls. */
export const RECENT_SESSIONS = 5;

/** How many sessions the picker offers. */
export const PICKED_SESSIONS = 10;

/** Where the conversation takes place, as its banner says it. */
export interface ConversationContext {
  /** The name of the project of the instance. */
  readonly project: string;
  /** Absolute path of the test repository. */
  readonly repository: string;
  /** The environment the sessions are opened against; `undefined` for the only one the configuration declares. */
  readonly environment?: string;
  /** The kind of database that keeps the sessions. */
  readonly database: "SQLite" | "PostgreSQL";
}

/**
 * What the conversation wrote for good, to the scrollback of the terminal: the banner, the sessions it recalls,
 * the heading of a thread, a block of it once settled, what a session came to, the help, or something it tells.
 */
export type Printed =
  | { readonly kind: "banner" }
  | { readonly kind: "recent"; readonly sessions: readonly Session[] }
  | { readonly kind: "heading"; readonly session: Session }
  | { readonly kind: "block"; readonly block: Block }
  | { readonly kind: "result"; readonly session: Session }
  | { readonly kind: "help" }
  | { readonly kind: "notice"; readonly tone: "info" | "error"; readonly text: string };

/** What stands over the input until the person answers it: the sessions to pick one from, or the confirmation of a stop. */
export type Overlay =
  | { readonly kind: "picker"; readonly sessions: readonly Session[]; readonly selected: number }
  | { readonly kind: "stop"; readonly session: string }
  /** The setting of the connection to the model, from the connection in force. */
  | { readonly kind: "model"; readonly inForce: Model };

/** The thread on screen. */
export interface ShownThread {
  /** The session, as it was last told. */
  readonly session: Session;
  /** Its events so far, in order. */
  readonly events: readonly SessionEvent[];
  /** How many blocks of its thread are written for good. */
  readonly settled: number;
  /** How many times the conversation resumed the session once it ended: each turn is followed anew, after the events of the turns before. */
  readonly resumed: number;
}

/** The conversation at a moment: everything its screen is drawn from. */
export interface ConversationState {
  readonly printed: readonly Printed[];
  /** The thread on screen; none at the start, where the next request opens a session. */
  readonly shown?: ShownThread;
  /** The sessions this process opened, and so runs, the latest last. */
  readonly hosted: readonly string[];
  /** What the input holds. */
  readonly input: string;
  /** Grows each time the input is set by something else than the keys typed in it, so that its cursor goes to its end. */
  readonly inputEpoch: number;
  readonly overlay?: Overlay;
  /** What the last key did, told on a line until the next one. */
  readonly notice?: string;
  /** Whether Ctrl-C was just pressed: pressed again, it leaves. */
  readonly armed: boolean;
  /** The time of the clock, in milliseconds, by which what goes on is timed. */
  readonly now: number;
  /** Set once the person leaves: at once, without waiting for the sessions this process runs, or not. */
  readonly leaving?: { readonly atOnce: boolean };
}

/**
 * @param sessions - The sessions of the instance, the latest first.
 * @param now - The time of the clock, in milliseconds.
 * @returns The conversation as it starts: its banner and the latest sessions written, nothing on screen yet.
 */
export function initialState(sessions: readonly Session[], now: number): ConversationState {
  return {
    printed: [{ kind: "banner" }, { kind: "recent", sessions: sessions.slice(0, RECENT_SESSIONS) }],
    hosted: [],
    input: "",
    inputEpoch: 0,
    armed: false,
    now,
  };
}
