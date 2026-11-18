import { createElement as h, type ReactNode } from "react";
import { ActionBlock } from "./action-block.ts";
import { NoteBlock } from "./note-block.ts";
import { OutcomeBlock } from "./outcome-block.ts";
import { PassRule } from "./pass-rule.ts";
import { PlanBlock } from "./plan-block.ts";
import { SaidBlock } from "./said-block.ts";
import { ScopeBlock } from "./scope-block.ts";
import { VerdictBlock } from "./verdict-block.ts";
import type { Theme } from "./palette.ts";
import type { Block } from "./thread-blocks.ts";

/** What a block of a thread needs. */
export interface BlockViewProps {
  readonly block: Block;
  /** Whether the block is on the live part of the screen, and may still change; written for good otherwise. */
  readonly live: boolean;
  readonly theme: Theme;
  /** The width of the terminal, in columns. */
  readonly width: number;
}

/**
 * One block of a thread, as its kind draws it.
 *
 * @param props - The block, where it is drawn, the theme and the width.
 * @returns The block.
 */
export function BlockView({ block, live, theme, width }: BlockViewProps): ReactNode {
  switch (block.kind) {
    case "action":
      return h(ActionBlock, { block, live, theme });
    case "note":
      return h(NoteBlock, { block, theme });
    case "pass":
      return h(PassRule, { block, theme, width });
    case "review":
    case "verdict":
      return h(VerdictBlock, { block, theme });
    case "plan":
      return h(PlanBlock, { block, theme });
    case "scope":
      return h(ScopeBlock, { block, theme });
    case "outcome":
      return h(OutcomeBlock, { block, theme });
    default:
      return h(SaidBlock, { block, theme });
  }
}
