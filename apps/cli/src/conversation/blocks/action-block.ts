import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { createElement as h, type ReactNode } from "react";
import { shortened } from "../../output/event-line.ts";
import { Marked } from "../view/marked.ts";
import { elapsedText } from "../view/session-facts.ts";
import { SpeakerHead } from "./speaker-head.ts";
import type { Theme, Tone } from "../view/palette.ts";
import type { Block } from "./thread-blocks.ts";

/** What an action needs. */
export interface ActionBlockProps {
  readonly block: Extract<Block, { kind: "action" }>;
  /** Whether the block is on the live part of the screen, where an action that goes on spins. */
  readonly live: boolean;
  readonly theme: Theme;
}

/**
 * An action of an agent, on one line under its name: its state in the gutter — a spinner while the tool has
 * not answered, then that it passed, failed, or simply ended —, what the agent did, cut to the line, and how
 * long it took. An action that failed says why on a second line, cut too.
 *
 * @param props - The block, where it is drawn, and the theme.
 * @returns The lines.
 */
export function ActionBlock({ block, live, theme }: ActionBlockProps): ReactNode {
  const { step } = block;
  const { glyphs } = theme;
  const pending = step.pending === true;
  const [mark, tone]: readonly [ReactNode, Tone] =
    pending && live
      ? [h(Spinner, { type: glyphs.spinner }), "accent"]
      : step.outcome === "failed"
        ? [glyphs.failed, "ko"]
        : step.outcome === "passed"
          ? [glyphs.passed, "ok"]
          : [glyphs.done, "muted"];
  return h(
    Box,
    { flexDirection: "column", marginTop: block.heads ? 1 : 0 },
    block.heads ? h(SpeakerHead, { speaker: block.agent, theme }) : null,
    h(
      Marked,
      { mark, style: theme.ink(tone), depth: 1 },
      h(
        Box,
        null,
        h(Box, { flexShrink: 1 }, h(Text, { wrap: "truncate-end" }, step.title)),
        step.durationMs === undefined ? null : h(Box, { flexShrink: 0 }, h(Text, theme.ink("muted"), ` ${glyphs.separator} ${elapsedText(step.durationMs)}`)),
      ),
      step.outcome === "failed" && step.detail !== undefined ? h(Text, { ...theme.ink("ko"), wrap: "truncate-end" }, shortened(step.detail)) : null,
    ),
  );
}
