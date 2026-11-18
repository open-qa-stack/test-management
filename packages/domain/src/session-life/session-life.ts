import type { SessionState } from "../sessions/session.ts";
import type { AddressedCommand, SessionCommand } from "./session-command.ts";
import type { SessionRefusal } from "./session-refusal.ts";

/** The state a session is in once it is asked for. */
export const ASKED_STATE: SessionState = "queued";

/** The states a session goes on in: it has not ended. */
const GOING = ["queued", "running"] as const satisfies readonly SessionState[];

/** The state a session waits in. */
const WAITING = ["queued"] as const satisfies readonly SessionState[];

/** The state a session is worked on in. */
const RUNNING = ["running"] as const satisfies readonly SessionState[];

/** What the life of a session says of one command. */
interface CommandRule {
  /** The states the command is for. */
  readonly from: readonly SessionState[];
  /** The state it leaves the session in, when it changes it. */
  readonly to?: SessionState;
}

/**
 * The life of a session: for each command, the states it is for, and the state it leaves the session in when
 * it changes it.
 *
 * @remarks
 * A session is asked for `queued`, becomes `running` when its host starts it, and ends `completed` or
 * `interrupted`; nothing leaves these two. What is told of the work of a session — its events, the delivery
 * of a message, its result — is taken while it runs; a person speaks to a session, and whoever stops it
 * interrupts it, as long as it goes on. A session has one host, the process that asked for it or took it
 * over, which beats on it as long as it goes on. A host that went silent died: a session it left running is
 * abandoned, and one it left waiting is taken over by a host that stays. Whoever keeps the sessions enforces
 * this table; the table says what its guards mean.
 */
export const SESSION_LIFE = {
  /** The host starts a session that waits. */
  start: { from: WAITING, to: "running" },
  /** The events the work of a session tells. */
  append: { from: RUNNING },
  /** The delivery of a pending message to an agent. */
  deliver: { from: RUNNING },
  /** The end of a session whose work went to its end. */
  complete: { from: RUNNING, to: "completed" },
  /** A message of the person to a session that goes on: one that waits keeps it for its first agent. */
  say: { from: GOING },
  /** The end of a session whose work stopped, one that still waited included. */
  interrupt: { from: GOING, to: "interrupted" },
  /** The sign of life of a host, on each session it hosts that goes on. */
  beat: { from: GOING },
  /** A host that stays takes a session that waits for a host that went silent: it waits for that host from then on. */
  takeOver: { from: WAITING },
  /** The end of a session a host that went silent left running; one that waits is left to wait. */
  abandon: { from: RUNNING, to: "interrupted" },
} as const satisfies Readonly<Record<SessionCommand, CommandRule>>;

/**
 * Tells whether a session ended.
 *
 * @param state - The state of the session; one that is not known is read as an end, as a client reads it.
 * @returns Whether the session no longer goes on.
 */
export function isTerminal(state: string): boolean {
  return !GOING.some((going) => going === state);
}

/**
 * Tells whether a command is for a session in a given state.
 *
 * @param command - The command.
 * @param state - The state of the session.
 * @returns Whether a session in that state takes the command.
 */
export function accepts(command: SessionCommand, state: string): boolean {
  const from: readonly string[] = SESSION_LIFE[command].from;
  return from.includes(state);
}

/**
 * Gives the state a command leaves a session in.
 *
 * @param command - The command.
 * @param state - The state of the session before the command.
 * @returns The state after it, which is the same for a command that changes none; `undefined` when the session
 * does not take the command.
 */
export function nextState(command: SessionCommand, state: SessionState): SessionState | undefined {
  if (!accepts(command, state)) return undefined;
  const rule: CommandRule = SESSION_LIFE[command];
  return rule.to ?? state;
}

/**
 * Tells why a command that names its session is refused.
 *
 * @param command - The command; those of a host name no session, and pick those they are for.
 * @param state - The state of the session; `undefined` when there is no such session.
 * @returns `unknown_session`, `session_ended` for a session that is completed or interrupted, `wrong_state`
 * for a session that goes on in a state the command is not for; `undefined` when the session takes the command.
 */
export function refusalOf(command: AddressedCommand, state: string | undefined): Exclude<SessionRefusal, "message_not_pending"> | undefined {
  if (state === undefined) return "unknown_session";
  if (isTerminal(state)) return "session_ended";
  return accepts(command, state) ? undefined : "wrong_state";
}
