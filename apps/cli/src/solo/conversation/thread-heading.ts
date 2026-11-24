import { Box, Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import type { Session } from "@open-qa-stack/domain/sessions";
import type { Theme } from "./palette.ts";
import { t } from "./i18n/i18n.ts";

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
  const opened = t("heading.opened", { day: session.openedAt.slice(0, 10), time: session.openedAt.slice(11, 19) });
  return h(
    Box,
    { marginTop: 1 },
    h(Text, null, h(Text, { bold: true }, t("heading.session", { id: session.id })), h(Text, theme.ink("muted"), ` ${theme.glyphs.separator} ${opened}`)),
  );
}
