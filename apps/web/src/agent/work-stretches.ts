import type { AgentRole, ToolStep, Turn } from "@open-qa-stack/domain/sessions";
import type { ShownStep } from "./playback.ts";

/** Turns of work that follow one another, folded as one: what the agents did and what the harness answered, without a word of theirs. */
export interface WorkStretch {
  readonly kind: "stretch";
  readonly turns: readonly Turn<ShownStep>[];
  /** The agents at work in it, in the order they came in. */
  readonly agents: readonly AgentRole[];
  readonly actions: number;
  /** How many of its actions failed. */
  readonly failed: number;
  /** How many refusals of the harness it holds. */
  readonly refusals: number;
  /** How many notes of the harness it holds. */
  readonly notes: number;
  /** How long its actions took, together, in milliseconds. */
  readonly durationMs: number;
  /** Whether one of its steps is still going. */
  readonly running: boolean;
}

/** What a thread shows, in order: a turn, or a stretch of work folded. */
export type ThreadEntry = Turn<ShownStep> | WorkStretch;

/** The steps of a turn. */
function itemsOf(turn: Turn<ShownStep>): readonly ShownStep[] {
  return "items" in turn ? turn.items : [turn.shown];
}

/**
 * Whether a turn is work a stretch folds: an agent that only thought and acted, refusals of the harness, its notes.
 * What an agent says, what the harness asks of it, a pass, a plan, a review and an outcome stay in sight.
 */
function isWork(turn: Turn<ShownStep>): boolean {
  if (turn.kind === "agent") return turn.items.every(({ step }) => step.kind === "tool" || (step.kind === "say" && step.thinking === true));
  if (turn.kind === "card") return turn.shown.step.kind === "verdict" && !turn.shown.step.accepted;
  return turn.kind === "refusals" || turn.kind === "notes";
}

/** The stretch the turns of work make, counted. */
function stretchOf(turns: readonly Turn<ShownStep>[]): WorkStretch {
  const steps = turns.flatMap(itemsOf);
  const actions = steps.flatMap(({ step }) => (step.kind === "tool" ? [step as ToolStep] : []));
  return {
    kind: "stretch",
    turns,
    agents: [...new Set(turns.flatMap((turn) => (turn.kind === "agent" ? [turn.agent] : [])))],
    actions: actions.length,
    failed: actions.filter(({ outcome }) => outcome === "failed").length,
    refusals: steps.filter(({ step }) => step.kind === "verdict").length,
    notes: steps.filter(({ step }) => step.kind === "note" || step.kind === "repeated").length,
    durationMs: actions.reduce((sum, { durationMs }) => sum + (durationMs ?? 0), 0),
    running: steps.some(({ running }) => running),
  };
}

/**
 * Folds the work of the agents that follows one another into stretches, so that a thread reads as what was asked,
 * what the agents said and what the harness decided: two turns of work or more in a row make a stretch, which holds
 * every turn as it was; a turn of work alone stays as it is.
 *
 * @param turns - The turns of the thread, in order.
 * @returns The entries of the thread, in order.
 */
export function stretchesOf(turns: readonly Turn<ShownStep>[]): ThreadEntry[] {
  const entries: ThreadEntry[] = [];
  let run: Turn<ShownStep>[] = [];
  const close = (): void => {
    if (run.length > 1) entries.push(stretchOf(run));
    else entries.push(...run);
    run = [];
  };
  for (const turn of turns) {
    if (isWork(turn)) run.push(turn);
    else {
      close();
      entries.push(turn);
    }
  }
  close();
  return entries;
}
