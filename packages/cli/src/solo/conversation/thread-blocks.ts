import {
  turnsOf,
  type AgentRole,
  type NoteStep,
  type OutcomeStep,
  type PassStep,
  type PlanStep,
  type RepeatedNoteStep,
  type ReviewStep,
  type SayStep,
  type ScopeStep,
  type Step,
  type ToolStep,
  type VerdictStep,
} from "@open-qa-stack/domain/sessions";

/** The most blocks the live part of a thread holds behind one that is still going, before that one is written as it is. */
export const MAX_LIVE_BLOCKS = 12;

/**
 * What a terminal writes of a thread in one go, and never rewrites once it is settled: a turn of the thread, or
 * one thing an agent said or did within its turn — so that an agent that acts fifty times in a row scrolls up
 * as it goes, under its name written once.
 */
export type Block =
  | { readonly kind: "request"; readonly step: SayStep }
  | { readonly kind: "message"; readonly step: SayStep; readonly deliveredTo?: AgentRole }
  | { readonly kind: "speech"; readonly agent: AgentRole; readonly heads: boolean; readonly step: SayStep }
  | { readonly kind: "action"; readonly agent: AgentRole; readonly heads: boolean; readonly step: ToolStep }
  | { readonly kind: "brief"; readonly step: SayStep }
  | { readonly kind: "note"; readonly heads: boolean; readonly step: NoteStep | RepeatedNoteStep }
  | { readonly kind: "pass"; readonly step: PassStep }
  | { readonly kind: "review"; readonly step: ReviewStep }
  | { readonly kind: "verdict"; readonly step: VerdictStep }
  | { readonly kind: "plan"; readonly step: PlanStep }
  | { readonly kind: "scope"; readonly step: ScopeStep }
  | { readonly kind: "outcome"; readonly step: OutcomeStep };

/** A card of a thread: the start of a pass, what the session works on, the verdict of a reviewer or of the harness, a plan or the outcome. */
type Card = PassStep | ScopeStep | ReviewStep | VerdictStep | PlanStep | OutcomeStep;

/**
 * Reads the steps of a thread as the blocks a terminal writes, grouped as every presentation groups them.
 *
 * @param steps - The steps of the script of a session, in order.
 * @returns The blocks: one per turn of the thread, and one per thing said or done within the turn of an agent
 * or per note within the notes of the harness, the first of which heads the turn and names who speaks.
 */
export function blocksOf(steps: readonly Step[]): Block[] {
  return turnsOf(steps.map((step) => ({ step }))).flatMap((turn): Block[] => {
    switch (turn.kind) {
      case "request":
      case "brief":
        return [{ kind: turn.kind, step: turn.shown.step as SayStep }];
      case "message":
        return [{ kind: "message", step: turn.shown.step as SayStep, ...(turn.deliveredTo === undefined ? {} : { deliveredTo: turn.deliveredTo }) }];
      case "agent":
        return turn.items.map(({ step }, index) =>
          step.kind === "tool"
            ? { kind: "action", agent: turn.agent, heads: index === 0, step }
            : { kind: "speech", agent: turn.agent, heads: index === 0, step: step as SayStep },
        );
      case "notes":
        return turn.items.map(({ step }, index) => ({ kind: "note", heads: index === 0, step: step as NoteStep | RepeatedNoteStep }));
      case "card": {
        const step = turn.shown.step as Card;
        return [{ kind: step.kind, step } as Block];
      }
    }
  });
}

/**
 * Whether a block may still change: an action whose tool has not answered, a review the harness has not answered,
 * a message no agent took yet, or the pass the thread ends on, which the request of the harness may still name.
 */
function isOpen(block: Block, last: boolean): boolean {
  if (block.kind === "action" || block.kind === "review") return block.step.pending === true;
  if (block.kind === "message") return block.deliveredTo === undefined;
  return block.kind === "pass" && last;
}

/**
 * Counts the blocks of a thread a terminal may write for good, to its scrollback.
 *
 * @param blocks - The blocks of the thread, in order.
 * @param live - Whether the session goes on: every block of one that ended is settled.
 * @returns How many blocks, from the first, will not change: those before the first that still may. A block
 * that stays open while more than {@link MAX_LIVE_BLOCKS} others follow it is settled as it is, so that what a
 * terminal keeps redrawing never outgrows its screen.
 */
export function settledCount(blocks: readonly Block[], live: boolean): number {
  if (!live) return blocks.length;
  const open = blocks.findIndex((block, index) => isOpen(block, index === blocks.length - 1) && blocks.length - index <= MAX_LIVE_BLOCKS + 1);
  return open === -1 ? blocks.length : open;
}
