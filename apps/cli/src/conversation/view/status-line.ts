import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { createElement as h, type ReactNode } from "react";
import type { Session } from "@open-qa-stack/domain/sessions";
import { sinceText, standing } from "./session-facts.ts";
import { standingTone } from "./session-line.ts";
import { identityOf } from "../blocks/speakers.ts";
import { GUTTER, type Theme } from "./palette.ts";
import type { ThreadProgress } from "../blocks/thread-progress.ts";

/** What the status line needs. */
export interface StatusLineProps {
  /** The session on screen, which goes on. */
  readonly session: Session;
  /** Where its work is. */
  readonly progress: ThreadProgress;
  /** The time of the clock, in milliseconds. */
  readonly now: number;
  readonly theme: Theme;
}

/**
 * Where the session on screen is while it goes on, on one line above the input: a spinner, how it stands, the
 * pass it is in, the agent at work and how long ago it was opened.
 *
 * @param props - The session, its progress, the clock and the theme.
 * @returns The line, cut to the width.
 */
export function StatusLine({ session, progress, now, theme }: StatusLineProps): ReactNode {
  const tone = theme.ink(standingTone(session));
  const facts = [
    progress.pass,
    progress.scenario,
    progress.agent === undefined ? undefined : identityOf(progress.agent).name,
    sinceText(Math.max(0, now - Date.parse(session.openedAt))),
  ].filter((fact) => fact !== undefined);
  return h(
    Box,
    { marginTop: 1 },
    h(Box, { width: GUTTER, flexShrink: 0 }, h(Text, tone, h(Spinner, { type: theme.glyphs.spinner }))),
    h(
      Text,
      { wrap: "truncate-end" },
      h(Text, { ...tone, bold: true }, standing(session)),
      h(Text, theme.ink("muted"), facts.map((fact) => ` ${theme.glyphs.separator} ${fact}`).join("")),
    ),
  );
}
