import { Box, Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import { Marked } from "./marked.ts";
import { IDENTITIES } from "./speakers.ts";
import type { Theme } from "./palette.ts";
import type { Block } from "./thread-blocks.ts";

/** What a note needs. */
export interface NoteBlockProps {
  readonly block: Extract<Block, { kind: "note" }>;
  readonly theme: Theme;
}

/**
 * A note of the harness: a muted line, under the mark of the harness when it opens a row of notes.
 *
 * @param props - The block and the theme.
 * @returns The line.
 */
export function NoteBlock({ block, theme }: NoteBlockProps): ReactNode {
  const { mark, ascii } = IDENTITIES.harness;
  return h(
    Box,
    { marginTop: block.heads ? 1 : 0 },
    h(Marked, { mark: block.heads ? (theme.unicode ? mark : ascii) : "", style: theme.ink("muted") }, h(Text, theme.ink("muted"), block.step.text)),
  );
}
