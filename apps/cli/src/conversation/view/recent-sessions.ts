import { Box, Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import type { Session } from "@open-qa-stack/domain/sessions";
import { SessionLine } from "./session-line.ts";
import type { Theme } from "./palette.ts";
import { t } from "../i18n/i18n.ts";

/** What the latest sessions need. */
export interface RecentSessionsProps {
  readonly sessions: readonly Session[];
  readonly theme: Theme;
}

/**
 * The latest sessions of the instance, as the start of the conversation recalls them — or that there is none yet.
 *
 * @param props - The sessions, the latest first, and the theme.
 * @returns The list, under its title.
 */
export function RecentSessions({ sessions, theme }: RecentSessionsProps): ReactNode {
  const muted = theme.ink("muted");
  return h(
    Box,
    { flexDirection: "column", marginTop: 1 },
    h(Text, muted, t(sessions.length === 0 ? "recent.none" : "recent.latest")),
    ...sessions.map((session) => h(SessionLine, { key: session.id, session, theme })),
  );
}
