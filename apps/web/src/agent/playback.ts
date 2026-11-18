import type { SessionScript, Speaker, Step } from "./session-script.ts";

/** How many characters of a message appear at each tick. */
export const CHARACTERS_PER_TICK = 4;

/** How many ticks a tool takes before it gives its result. */
export const TOOL_TICKS = 10;

/** How many ticks pass after a step before the next one starts. */
export const PAUSE_TICKS = 6;

/** How a person reads a session: as it is now, or replayed from its start at their pace. */
export interface Playback {
  /** Whether the thread shows the session as it is now, every step in full; a replay otherwise. */
  readonly following: boolean;
  /** How far the replay is, in ticks. */
  readonly tick: number;
  /** Whether the replay goes on by itself. */
  readonly playing: boolean;
  /** How many ticks pass at each beat. */
  readonly speed: number;
}

/** What changes a playback. */
export type PlaybackAction =
  | { readonly type: "beat" }
  | { readonly type: "toggle" }
  | { readonly type: "restart" }
  | { readonly type: "faster" }
  | { readonly type: "skip" }
  | { readonly type: "follow" };

/** A step as the thread shows it at a moment. */
export interface ShownStep {
  /** Its rank in the script, from 0. */
  readonly index: number;
  readonly step: Step;
  /** How much of its text is written, for a message. */
  readonly written: string;
  /** Whether it is still going: a message being written, a tool that has not answered. */
  readonly running: boolean;
}

/** A session at a moment: what the thread shows and what goes around it. */
export interface Frame {
  readonly shown: readonly ShownStep[];
  /** Who is speaking or acting, if anyone. */
  readonly speaking?: Speaker;
  /** Whether nothing more is to come: every step is shown in full and the run has ended. */
  readonly finished: boolean;
  /** How many tools were used. */
  readonly actions: number;
  /** The pass the session is in. */
  readonly pass?: string;
  /** The rank of that pass among the passes of the session, from 0. */
  readonly passRank?: number;
  /** How far the replay is, from 0 to 1. */
  readonly progress: number;
}

/** The speeds a replay goes through, in ticks per beat. */
const SPEEDS = [1, 2, 4, 8];

/** The playback of a session a person just opened: the session as it is now. */
export const INITIAL_PLAYBACK: Playback = { following: true, tick: 0, playing: false, speed: 1 };

/**
 * How long a step takes to show in a replay, in ticks, the pause after it left out.
 *
 * @param step - The step.
 * @returns Its duration; a message of an agent takes the time to write it, one of the person none, a tool the
 * time to answer, anything else one tick.
 */
export function durationOf(step: Step): number {
  if (step.kind === "say") return step.from === "user" ? 0 : Math.ceil(step.text.length / CHARACTERS_PER_TICK);
  if (step.kind === "tool") return TOOL_TICKS;
  return 1;
}

/**
 * The tick at which a replay has shown every step of a script in full.
 *
 * @param script - The script.
 * @returns The sum of the durations and of the pauses of its steps.
 */
export function endOf(script: SessionScript): number {
  return script.steps.reduce((total, step) => total + durationOf(step) + PAUSE_TICKS, 0);
}

/** Who a step comes from: its speaker, or the harness for what it decides and notes; nobody for the start of a pass or a card. */
function fromOf(step: Step): Speaker | undefined {
  if (step.kind === "verdict" || step.kind === "note") return "harness";
  return "from" in step ? step.from : undefined;
}

/** Every step of a session in full, as a person who follows it sees it; a tool that has not answered still runs while the run does. */
function followed(script: SessionScript): { readonly shown: ShownStep[]; readonly speaking?: Speaker } {
  const shown = script.steps.map((step, index) => ({
    index,
    step,
    written: step.kind === "say" ? step.text : "",
    running: script.live && step.kind === "tool" && step.pending === true,
  }));
  const last = script.steps.at(-1);
  const speaking = script.live && last !== undefined ? fromOf(last) : undefined;
  return { shown, ...(speaking === undefined ? {} : { speaking }) };
}

/** The steps a replay shows at a tick, the one in progress partly. */
function replayed(script: SessionScript, tick: number): { readonly shown: ShownStep[]; readonly speaking?: Speaker } {
  const shown: ShownStep[] = [];
  let start = 0;
  let speaking: Speaker | undefined;
  for (const [index, step] of script.steps.entries()) {
    if (tick < start) break;
    const duration = durationOf(step);
    const elapsed = tick - start;
    const running = elapsed < duration;
    shown.push({ index, step, written: step.kind === "say" ? step.text.slice(0, running ? elapsed * CHARACTERS_PER_TICK : step.text.length) : "", running });
    if (running && (step.kind === "say" || step.kind === "tool")) speaking = step.from;
    start += duration + PAUSE_TICKS;
  }
  return { shown, ...(speaking === undefined ? {} : { speaking }) };
}

/**
 * What a session shows at a moment.
 *
 * @param script - The session.
 * @param playback - Whether it is followed, or how far its replay is.
 * @returns The frame: the steps shown, who speaks, whether anything more is to come.
 */
export function frameOf(script: SessionScript, playback: Playback): Frame {
  const { shown, speaking } = playback.following ? followed(script) : replayed(script, playback.tick);
  const end = endOf(script);
  return {
    shown,
    ...(speaking === undefined ? {} : { speaking }),
    finished: !script.live && (playback.following || playback.tick >= end - PAUSE_TICKS),
    actions: shown.filter(({ step, running }) => step.kind === "tool" && !running).length,
    ...passOf(shown),
    progress: playback.following || end === 0 ? 1 : Math.min(1, playback.tick / end),
  };
}

/** The pass the last steps shown belong to, and its rank among the passes of the session. */
function passOf(shown: readonly ShownStep[]): { readonly pass?: string; readonly passRank?: number } {
  const passes = shown.flatMap(({ step }) => (step.kind === "pass" && step.minor !== true ? [step.title] : []));
  return passes.length === 0 ? {} : { pass: passes.at(-1)!, passRank: passes.length - 1 };
}

/**
 * Applies an action to the playback of a session.
 *
 * @param script - The session.
 * @param playback - The playback.
 * @param action - What happens: a beat of the clock, or a control.
 * @returns The playback after it. A replay starts from the first step and goes on by itself; a beat moves it
 * on by its speed, and once it has shown everything the session is followed again, so that a run that still
 * writes goes on live. Following shows the session as it is now.
 */
export function played(script: SessionScript, playback: Playback, action: PlaybackAction): Playback {
  switch (action.type) {
    case "beat": {
      if (playback.following || !playback.playing) return playback;
      const tick = playback.tick + playback.speed;
      return tick >= endOf(script) ? { ...playback, following: true, playing: false } : { ...playback, tick };
    }
    case "toggle":
      return playback.following ? playback : { ...playback, playing: !playback.playing };
    case "restart":
      return { following: false, tick: 0, playing: true, speed: playback.speed };
    case "faster":
      return { ...playback, speed: SPEEDS[(SPEEDS.indexOf(playback.speed) + 1) % SPEEDS.length]! };
    case "skip":
      return playback.following ? playback : skipped(script, playback);
    case "follow":
      return { ...playback, following: true, playing: false };
  }
}

/** Moves a replay to the next decision of the harness it has not shown — a verdict, a plan it accepted — stopped there, or follows the session when none is left. */
function skipped(script: SessionScript, playback: Playback): Playback {
  let start = 0;
  for (const step of script.steps) {
    const shown = start + durationOf(step);
    if ((step.kind === "verdict" || step.kind === "plan") && shown > playback.tick) return { ...playback, tick: shown, playing: false };
    start = shown + PAUSE_TICKS;
  }
  return { ...playback, following: true, playing: false };
}

/** A pass of a session, and where the session is with it. */
export interface PassProgress {
  /** Its title, such as `Plan · smoke`. */
  readonly title: string;
  /** `done` once a later pass started or the session ended, `current` while the session is in it, `pending` before. */
  readonly state: "done" | "current" | "pending";
}

/**
 * Where a session is with each of its passes.
 *
 * @param script - The session.
 * @param frame - The session at a moment.
 * @returns Its passes, in order, each with its state; the parts of a pass are left out.
 */
export function passesOf(script: SessionScript, frame: Frame): PassProgress[] {
  const titles = script.steps.flatMap((step) => (step.kind === "pass" && step.minor !== true ? [step.title] : []));
  const current = frame.passRank ?? -1;
  return titles.map((title, index) => ({
    title,
    state: index < current || (frame.finished && index === current) ? "done" : index === current ? "current" : "pending",
  }));
}

/** What the thread of a session keeps: everything, what is said, what is done, or what the harness decides. */
export type ThreadFilter = "all" | "talk" | "actions" | "verdicts";

/**
 * Tells whether the thread shows a step, given what it keeps.
 *
 * @param step - The step.
 * @param filter - What the thread keeps.
 * @param speaker - The only speaker the thread follows, if any.
 * @returns Whether the step shows. The start of a pass always does; a verdict or a note is the harness speaking.
 */
export function shows(step: Step, filter: ThreadFilter, speaker?: Speaker): boolean {
  if (step.kind === "pass") return true;
  if (speaker !== undefined && fromOf(step) !== speaker) return false;
  if (filter === "talk") return step.kind === "say";
  if (filter === "actions") return step.kind === "tool" || step.kind === "plan" || step.kind === "outcome";
  if (filter === "verdicts") return step.kind === "verdict" || step.kind === "note";
  return true;
}
