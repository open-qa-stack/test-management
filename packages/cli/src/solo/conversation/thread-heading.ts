import { Box, Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import type { Session } from "@open-qa-stack/domain/sessions";
import type { Theme } from "./palette.ts";

/** What the heading of a thread needs. */
export interface ThreadHeadingProps {
  readonly session: Session;
  readonly theme: Theme;
}

/**
 * What opens the thread of a session: its identifier, by which every other command names it, and when it was opened.
 *
 * @param props - The session and the theme.
 * @returns The heading.
 */
export function ThreadHeading({ session, theme }: ThreadHeadingProps): ReactNode {
  const opened = `${session.openedAt.slice(0, 10)} ${session.openedAt.slice(11, 19)} UTC`;
  return h(
    Box,
    { marginTop: 1 },
    h(Text, null, h(Text, { bold: true }, `Session ${session.id}`), h(Text, theme.ink("muted"), ` ${theme.glyphs.separator} opened ${opened}`)),
  );
}
