import { Box, Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import { Marked } from "./marked.ts";
import type { Theme } from "./palette.ts";
import type { SlashCommand } from "./slash-commands.ts";

/** The width of the column of the names, in columns. */
const NAMES = 12;

/** What the hints of the commands need. */
export interface CommandHintsProps {
  /** The commands the person may be typing; the first is the one Tab completes. */
  readonly commands: readonly SlashCommand[];
  readonly theme: Theme;
}

/**
 * The commands the person may be typing, under the input: each on a line with what it does, the one Tab
 * completes pointed at.
 *
 * @param props - The commands and the theme.
 * @returns The lines.
 */
export function CommandHints({ commands, theme }: CommandHintsProps): ReactNode {
  const accent = theme.ink("accent");
  return h(
    Box,
    { flexDirection: "column" },
    ...commands.map(({ name, takes, does }, index) =>
      h(
        Marked,
        { key: name, mark: index === 0 ? theme.glyphs.pointer : "", style: accent },
        h(
          Text,
          { wrap: "truncate-end" },
          h(Text, accent, `/${name}${takes === undefined ? "" : ` ${takes}`}`.padEnd(NAMES)),
          h(Text, theme.ink("muted"), does),
        ),
      ),
    ),
  );
}
