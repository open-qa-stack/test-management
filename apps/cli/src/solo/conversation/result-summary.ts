import { Box, Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import type { Session } from "@open-qa-stack/domain/sessions";
import { elapsedText, standing, stateText } from "./session-facts.ts";
import { standingTone } from "./session-line.ts";
import type { Theme } from "./palette.ts";
import { t } from "./i18n/i18n.ts";

/** What the summary of a session needs. */
export interface ResultSummaryProps {
  /** The session, once it ended. */
  readonly session: Session;
  readonly theme: Theme;
}

/**
 * What a session came to, at the end of its thread: how it ended, then its facts — how long it took, how many
 * requests it sent to the model, how many of its tests passed, and the branch they were written on.
 *
 * @param props - The session and the theme.
 * @returns The summary; a session that was interrupted has no fact to give.
 */
export function ResultSummary({ session, theme }: ResultSummaryProps): ReactNode {
  const { result } = session;
  const tests = result?.tests ?? [];
  const facts =
    result === undefined
      ? []
      : [
          elapsedText(result.durationMs),
          t("summary.modelRequests", { count: result.modelRequests }),
          ...(tests.length === 0
            ? []
            : [t("summary.testsPassed", { passed: tests.filter(({ verdict }) => verdict === "passed").length, count: tests.length })]),
          ...(result.branch === undefined ? [] : [t("summary.branch", { name: result.branch })]),
        ];
  return h(
    Box,
    { flexDirection: "column", marginTop: 1 },
    h(
      Text,
      { ...theme.ink(standingTone(session)), bold: true },
      t("summary.session", {
        state: result === undefined ? stateText(session.state) : `${stateText(session.state)} ${theme.glyphs.separator} ${standing(session)}`,
      }),
    ),
    facts.length === 0 ? null : h(Text, theme.ink("muted"), facts.join(` ${theme.glyphs.separator} `)),
  );
}
