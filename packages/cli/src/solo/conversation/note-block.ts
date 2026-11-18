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
 * A note of the harness: a muted line, under the mark of the harness when it opens a row of notes. Notes alike
 * about several sources are one line, what they say around the name of a source, with how many, then the
 * sources on a line of their own.
 *
 * @param props - The block and the theme.
 * @returns The lines.
 */
export function NoteBlock({ block, theme }: NoteBlockProps): ReactNode {
  const { mark, ascii } = IDENTITIES.harness;
  const { step } = block;
  const muted = theme.ink("muted");
  return h(
    Box,
    { marginTop: block.heads ? 1 : 0 },
    h(
      Marked,
      { mark: block.heads ? (theme.unicode ? mark : ascii) : "", style: muted },
      step.kind === "note"
        ? h(Text, muted, step.text)
        : [
            h(Text, { key: "note", ...muted }, `${step.before}…${step.after} ${theme.glyphs.separator} ${step.sources.length} sources`),
            h(Text, { key: "sources", ...muted }, step.sources.join(", ")),
          ],
    ),
  );
}
