import { Box, Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import { GUTTER, type Theme } from "./palette.ts";
import type { Block } from "../blocks/thread-blocks.ts";

/** What the rule of a pass needs. */
export interface PassRuleProps {
  readonly block: Extract<Block, { kind: "pass" }>;
  readonly theme: Theme;
  /** The width of the terminal, in columns. */
  readonly width: number;
}

/**
 * The start of a phase: a rule across the width, its title at the left. A part of a pass — the review of a
 * plan, the writing of one test — is a shorter, muted one, with the scenario it works on.
 *
 * @param props - The block, the theme and the width.
 * @returns The rule.
 */
export function PassRule({ block, theme, width }: PassRuleProps): ReactNode {
  const { step } = block;
  const { rule, separator } = theme.glyphs;
  const muted = theme.ink("muted");
  const title = step.summary === "" ? step.title : `${step.title} ${separator} ${step.summary}`;
  if (step.minor === true) return h(Box, { marginTop: 1 }, h(Text, { ...muted, wrap: "truncate-end" }, `${rule.repeat(GUTTER)} ${title}`));
  // The rule takes what the title leaves of the width, counted in characters as a person sees them; a title of wide characters leaves it cut.
  const left = Math.max(0, width - GUTTER - [...new Intl.Segmenter().segment(title)].length - 2);
  return h(
    Box,
    { marginTop: 1 },
    h(Text, { wrap: "truncate-end" }, h(Text, muted, `${rule.repeat(GUTTER)} `), h(Text, { bold: true }, title), h(Text, muted, ` ${rule.repeat(left)}`)),
  );
}
