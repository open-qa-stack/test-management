import { Box, Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import { Banner } from "./banner.ts";
import { BlockView } from "./block-view.ts";
import { Help } from "./help.ts";
import { Marked } from "./marked.ts";
import { RecentSessions } from "./recent-sessions.ts";
import { ResultSummary } from "./result-summary.ts";
import { ThreadHeading } from "./thread-heading.ts";
import type { ConversationContext, Printed } from "./conversation-state.ts";
import type { Theme } from "./palette.ts";

/** What something written for good needs. */
export interface PrintedItemProps {
  readonly item: Printed;
  readonly context: ConversationContext;
  readonly theme: Theme;
  /** The width of the terminal, in columns. */
  readonly width: number;
}

/**
 * Something the conversation writes once, to the scrollback of the terminal, as its kind draws it. Something
 * that failed is marked as a refusal is, and says what to do; nothing here is ever a stack trace.
 *
 * @param props - What is written, where the conversation takes place, the theme and the width.
 * @returns What is written.
 */
export function PrintedItem({ item, context, theme, width }: PrintedItemProps): ReactNode {
  switch (item.kind) {
    case "banner":
      return h(Banner, { context, theme });
    case "recent":
      return h(RecentSessions, { sessions: item.sessions, theme });
    case "heading":
      return h(ThreadHeading, { session: item.session, theme });
    case "block":
      return h(BlockView, { block: item.block, live: false, theme, width });
    case "result":
      return h(ResultSummary, { session: item.session, theme });
    case "help":
      return h(Help, { theme });
    case "output":
      return h(
        Box,
        { marginTop: 1 },
        item.failed ? h(Marked, { mark: theme.glyphs.failed, style: theme.ink("ko") }, h(Text, theme.ink("ko"), item.text)) : h(Text, null, item.text),
      );
    case "notice":
      return h(
        Box,
        { marginTop: 1 },
        item.tone === "error"
          ? h(Marked, { mark: theme.glyphs.failed, style: theme.ink("ko") }, h(Text, theme.ink("ko"), item.text))
          : h(Marked, null, h(Text, null, item.text)),
      );
  }
}
