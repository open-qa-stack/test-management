import { Box, Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import { Marked } from "./marked.ts";
import type { Theme, Tone } from "./palette.ts";
import type { Block } from "./thread-blocks.ts";

/** What a decision of the harness needs. */
export interface CardBlockProps {
  readonly block: Extract<Block, { kind: "verdict" | "plan" | "outcome" }>;
  readonly theme: Theme;
}

/** The plural of a count, as `3 scenarios`. */
function counted(count: number, one: string): string {
  return `${count} ${one}${count === 1 ? "" : "s"}`;
}

/** How the verdict of a test is drawn: its glyph and its tone; a verdict that is neither a success nor a failure warns. */
function verdictMark(verdict: string, theme: Theme): readonly [string, Tone] {
  if (verdict === "passed") return [theme.glyphs.passed, "ok"];
  return verdict === "failed" ? [theme.glyphs.failed, "ko"] : ["!", "warn"];
}

/**
 * A decision of the harness, set apart from the turns of the agents: a refusal, marked as one, with the code
 * of its gate, the phase it is about, and under them what it says to do — or, when no gate gave it, the error
 * the work hit; the plan it accepted, as the short
 * list of its scenarios; or what the session produced, the verdict of each test, with why when it did not pass.
 *
 * @param props - The block and the theme.
 * @returns The lines.
 */
export function CardBlock({ block, theme }: CardBlockProps): ReactNode {
  const { glyphs } = theme;
  const muted = theme.ink("muted");
  const between = ` ${glyphs.separator} `;
  if (block.kind === "verdict") {
    const { step } = block;
    const ko = theme.ink("ko");
    return h(
      Box,
      { flexDirection: "column", marginTop: 1 },
      h(
        Marked,
        { mark: glyphs.failed, style: ko },
        h(
          Text,
          null,
          h(Text, { ...ko, bold: true }, step.code === undefined ? "Error" : "Refused by the harness"),
          h(
            Text,
            muted,
            [step.code, step.about]
              .filter((part) => part !== undefined)
              .map((part) => `${between}${part}`)
              .join(""),
          ),
        ),
        h(Text, null, step.text),
      ),
    );
  }
  if (block.kind === "plan") {
    const { step } = block;
    return h(
      Box,
      { flexDirection: "column", marginTop: 1 },
      h(
        Marked,
        { mark: glyphs.passed, style: theme.ink("ok") },
        h(Text, null, h(Text, { bold: true }, step.title), h(Text, muted, `${between}${counted(step.scenarios.length, "scenario")}`)),
        ...step.scenarios.map((scenario, index) =>
          h(
            Text,
            { key: index, wrap: "truncate-end" },
            `${index + 1}. `,
            h(Text, muted, `${scenario.priority} `),
            scenario.title,
            scenario.source === "" ? null : h(Text, muted, `${between}${scenario.source}`),
          ),
        ),
      ),
    );
  }
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
