import { Box, Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import type { AgentRole } from "@open-qa-stack/domain/sessions";
import { shortened } from "../event-line.ts";
import { Marked } from "./marked.ts";
import { SpeakerHead } from "./speaker-head.ts";
import { IDENTITIES } from "./speakers.ts";
import type { Theme } from "./palette.ts";
import type { Block } from "./thread-blocks.ts";

/** What something said needs. */
export interface SaidBlockProps {
  readonly block: Extract<Block, { kind: "request" | "message" | "speech" | "brief" }>;
  readonly theme: Theme;
}

/** Where a message the person sent during the session is. */
function delivery(deliveredTo: AgentRole | undefined): string {
  return deliveredTo === undefined ? "waiting for an agent" : `delivered to the ${IDENTITIES[deliveredTo].name.toLowerCase()}`;
}

/**
 * Something said in a thread: what the person asked, a message they sent since — with its number, and where it
 * is: waiting for an agent, or delivered to one —, what an agent said or thought, or what the harness asked of
 * an agent. A reasoning and a request of the harness are muted and kept to one line, cut: they are the
 * working of the session, not its conversation.
 *
 * @param props - The block and the theme.
 * @returns The lines: the head of who speaks when the block opens their turn, then what they said.
 */
export function SaidBlock({ block, theme }: SaidBlockProps): ReactNode {
  const { step } = block;
  const muted = theme.ink("muted");
  switch (block.kind) {
    case "request":
      return h(Box, { flexDirection: "column", marginTop: 1 }, h(SpeakerHead, { speaker: "user", theme }), h(Marked, null, h(Text, null, step.text)));
    case "message":
      return h(
        Box,
        { flexDirection: "column", marginTop: 1 },
        h(SpeakerHead, { speaker: "user", after: `${theme.glyphs.separator} message ${step.number}`, theme }),
        h(Marked, null, h(Text, null, step.text), h(Text, muted, delivery(block.deliveredTo))),
      );
    case "brief":
      return h(
        Box,
        { flexDirection: "column", marginTop: 1 },
        h(SpeakerHead, { speaker: "harness", after: `${theme.glyphs.arrow} ${IDENTITIES[step.to!].name}`, theme }),
        h(Marked, null, h(Text, muted, shortened(step.text))),
      );
    case "speech":
      return h(
        Box,
        { flexDirection: "column", marginTop: block.heads ? 1 : 0 },
        block.heads ? h(SpeakerHead, { speaker: block.agent, theme }) : null,
        h(Marked, null, step.thinking === true ? h(Text, { ...muted, italic: true }, `thinks: ${shortened(step.text)}`) : h(Text, null, step.text)),
      );
  }
}
