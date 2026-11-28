import type { PassStep, SessionPhase, Turn } from "@open-qa-stack/domain/sessions";
import type { ShownStep } from "./playback.ts";

/** Where a phase of a session is: over, the one its agents work in, or the one it stopped in without ending. */
export type PhaseState = "done" | "current" | "interrupted";

/** The phases of the cartography, which a session tells as one. */
const CARTOGRAPHY: ReadonlySet<SessionPhase> = new Set(["survey", "card", "consolidation", "knowledge-base"]);

/** A family of phases: one phase of the work, the cartography for all of its parts. */
export type PhaseFamily = SessionPhase | "cartography";

/** A phase of a session as its conversation shows it: the turns from the pass that opens it to the next. */
export interface PhaseView {
  /** What names it among what the person unfolded, from the rank of its first step: `phase-12`. */
  readonly key: string;
  readonly family: PhaseFamily;
  /** The title of the pass that opens it. */
  readonly title: string;
  /** The pass that opens it. */
  readonly pass: PassStep;
  /** Its turns, the pass that opens it left out. */
  readonly turns: readonly Turn<ShownStep>[];
  /** The time of its first step, and of its last. */
  readonly from: string;
  readonly to: string;
  /** How many tests were written in it. */
  readonly written: number;
  /** Whether it holds what the session produced. */
  readonly produced: boolean;
  readonly state: PhaseState;
}

/** The conversation of a session: what opened it, then its phases. */
export interface Conversation {
  /** The turns before the first phase: the request, and what the person said before the agents started. */
  readonly head: readonly Turn<ShownStep>[];
  readonly phases: readonly PhaseView[];
}

/** Where a session is, as its phases tell it. */
export type SessionEnding = "live" | "interrupted" | "ended";

/** The family of a phase. */
export function familyOf(phase: SessionPhase): PhaseFamily {
  return CARTOGRAPHY.has(phase) ? "cartography" : phase;
}

/** The pass a turn opens with, when it is the card of one. */
function passOf(turn: Turn<ShownStep>): PassStep | undefined {
  return turn.kind === "card" && turn.shown.step.kind === "pass" ? turn.shown.step : undefined;
}

/** The steps of a turn. */
function itemsOf(turn: Turn<ShownStep>): readonly ShownStep[] {
  return "items" in turn ? turn.items : [turn.shown];
}

/** Whether a pass opens a phase of its own: one that is no part of another, and no later part of the cartography. */
function opens(pass: PassStep, current: PhaseFamily | undefined): boolean {
  if (pass.minor === true) return false;
  return !(familyOf(pass.phase) === "cartography" && current === "cartography");
}

/**
 * Splits the turns of a session into its phases: each pass that is no part of another opens one, the parts of the
 * cartography but the first excepted, which stay in its phase.
 *
 * @param turns - The turns of the conversation, in order.
 * @param ending - Where the session is: its last phase goes on while it does, and the one it stopped in, with its summary, did not end.
 * @returns What opened the session, then its phases, in order.
 */
export function conversationOf(turns: readonly Turn<ShownStep>[], ending: SessionEnding): Conversation {
  const head: Turn<ShownStep>[] = [];
  const opened: { readonly pass: PassStep; readonly rank: number; readonly turns: Turn<ShownStep>[] }[] = [];
  for (const turn of turns) {
    const last = opened.at(-1);
    if (turn.kind === "card" && turn.shown.step.kind === "pass" && opens(turn.shown.step, last === undefined ? undefined : familyOf(last.pass.phase)))
      opened.push({ pass: turn.shown.step, rank: turn.shown.index, turns: [] });
    else if (last === undefined) head.push(turn);
    else last.turns.push(turn);
  }
  const working = opened.findLastIndex(({ pass }) => pass.phase !== "summary");
  const phases = opened.map(({ pass, rank, turns: held }, index): PhaseView => {
    const steps = held.flatMap(itemsOf);
    const stopped = ending === "interrupted" && (index === working || pass.phase === "summary");
    return {
      key: `phase-${rank}`,
      family: familyOf(pass.phase),
      title: pass.title,
      pass,
      turns: held,
      from: pass.at,
      to: steps.at(-1)?.step.at ?? pass.at,
      written: held.filter((turn) => passOf(turn)?.phase === "write").length,
      produced: held.some((turn) => turn.kind === "card" && turn.shown.step.kind === "outcome"),
      state: stopped ? "interrupted" : ending === "live" && index === opened.length - 1 ? "current" : "done",
    };
  });
  return { head, phases };
}

/**
 * Whether a phase opens by itself: the one the agents work in, the one the session stopped in, the summary, and the
 * one that holds what the session produced.
 *
 * @param phase - The phase.
 * @returns Whether it is open until the person folds it.
 */
export function opensByItself(phase: PhaseView): boolean {
  return phase.state !== "done" || phase.family === "summary" || phase.produced;
}

/** Phases that follow one another in one family, as the line of the state of a session tells them. */
export interface PhaseGroup {
  readonly family: PhaseFamily;
  /** The title of its first phase. */
  readonly title: string;
  /** How many phases it holds. */
  readonly count: number;
  /** The state of its last phase. */
  readonly state: PhaseState;
}

/**
 * Gathers the phases that follow one another in one family, the passes of the plan of each level of a round in a row.
 *
 * @param phases - The phases, in order.
 * @returns The groups, in order.
 */
export function groupsOf(phases: readonly PhaseView[]): PhaseGroup[] {
  const groups: PhaseGroup[] = [];
  for (const phase of phases) {
    const last = groups.at(-1);
    if (last?.family === phase.family) groups[groups.length - 1] = { ...last, count: last.count + 1, state: phase.state };
    else groups.push({ family: phase.family, title: phase.pass.title, count: 1, state: phase.state });
  }
  return groups;
}
