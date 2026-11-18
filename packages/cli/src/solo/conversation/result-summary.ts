import { Box, Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import type { Session } from "@open-qa-stack/domain/sessions";
import { elapsedText, standing } from "./session-facts.ts";
import { standingTone } from "./session-line.ts";
import type { Theme } from "./palette.ts";

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
          `${result.modelRequests} model request${result.modelRequests === 1 ? "" : "s"}`,
          ...(tests.length === 0
            ? []
            : [`${tests.filter(({ verdict }) => verdict === "passed").length} of ${tests.length} test${tests.length === 1 ? "" : "s"} passed`]),
          ...(result.branch === undefined ? [] : [`branch ${result.branch}`]),
        ];
  return h(
    Box,
    { flexDirection: "column", marginTop: 1 },
    h(
      Text,
      { ...theme.ink(standingTone(session)), bold: true },
      `Session ${result === undefined ? session.state : `${session.state} ${theme.glyphs.separator} ${standing(session)}`}`,
    ),
    facts.length === 0 ? null : h(Text, theme.ink("muted"), facts.join(` ${theme.glyphs.separator} `)),
  );
}
