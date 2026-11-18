import { createElement as h, type ReactNode } from "react";
import { ActionBlock } from "./action-block.ts";
import { CardBlock } from "./card-block.ts";
import { NoteBlock } from "./note-block.ts";
import { PassRule } from "./pass-rule.ts";
import { PlanBlock } from "./plan-block.ts";
import { ReviewBlock } from "./review-block.ts";
import { SaidBlock } from "./said-block.ts";
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
      return h(ReviewBlock, { block, theme });
    case "plan":
      return h(PlanBlock, { block, theme });
    case "verdict":
    case "outcome":
      return h(CardBlock, { block, theme });
    default:
      return h(SaidBlock, { block, theme });
  }
}
