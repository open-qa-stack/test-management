import { Box, Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import { Marked } from "./marked.ts";
import type { Theme, Tone } from "./palette.ts";
import type { Block } from "./thread-blocks.ts";

/** What the outcome of a session needs. */
export interface OutcomeBlockProps {
  readonly block: Extract<Block, { kind: "outcome" }>;
  readonly theme: Theme;
}

/** How the verdict of a test is drawn: its glyph and its tone; a verdict that is neither a success nor a failure warns. */
function verdictMark(verdict: string, theme: Theme): readonly [string, Tone] {
  if (verdict === "passed") return [theme.glyphs.passed, "ok"];
  return verdict === "failed" ? [theme.glyphs.failed, "ko"] : ["!", "warn"];
}

/**
 * What the session produced, set apart from the turns of the agents: the verdict of each test, with why when it
 * did not pass.
 *
 * @param props - The block and the theme.
 * @returns The lines.
 */
export function OutcomeBlock({ block, theme }: OutcomeBlockProps): ReactNode {
  const muted = theme.ink("muted");
  const { step } = block;
  return h(
    Box,
    { flexDirection: "column", marginTop: 1 },
    h(Marked, null, h(Text, { bold: true }, step.title)),
    ...step.tests.map((test, index) => {
      const [mark, tone] = verdictMark(test.verdict, theme);
      return h(
        Marked,
        { key: index, mark, style: theme.ink(tone) },
        h(Text, { wrap: "truncate-end" }, h(Text, theme.ink(tone), test.verdict.replaceAll("_", " ")), `  ${test.title}`),
        test.verdict === "passed" || test.note === undefined ? null : h(Text, muted, test.note),
      );
    }),
  );
}
