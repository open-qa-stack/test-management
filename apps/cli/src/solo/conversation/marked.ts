import { Box, Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import { GUTTER, type TextStyle } from "./palette.ts";

/** What a marked line needs. */
export interface MarkedProps {
  /** What the gutter holds: the mark of who speaks, the state of an action, or nothing. */
  readonly mark?: ReactNode;
  /** How the mark is drawn. */
  readonly style?: TextStyle;
  /** How far the line is indented, in gutters; none by default. */
  readonly depth?: number;
  readonly children?: ReactNode;
}

/**
 * A line of the conversation as its layout sets every one: a mark in the gutter, then what is said or done,
 * which wraps under itself and never under the mark.
 *
 * @param props - The mark, its style, the indentation and what the line holds.
 * @returns The line.
 */
export function Marked({ mark, style = {}, depth = 0, children }: MarkedProps): ReactNode {
  return h(
    Box,
    { paddingLeft: depth * GUTTER },
    h(Box, { width: GUTTER, flexShrink: 0 }, h(Text, style, mark)),
    h(Box, { flexDirection: "column", flexGrow: 1, flexShrink: 1 }, children),
  );
}
