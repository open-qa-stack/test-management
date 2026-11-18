import { Box, Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import { SLASH_COMMANDS } from "./slash-commands.ts";
import type { Theme } from "./palette.ts";

/** The keys of the conversation, and what each does. */
const KEYS: readonly (readonly [string, string])[] = [
  ["Enter", "Open a session with what you typed, say it to the agents of the session that goes on, or go on with the session that ended"],
  ["Tab", "Complete the command you are typing"],
  ["Up, Down", "Move in a list"],
  ["Esc", "Close a list or a confirmation"],
  ["Ctrl-C", "Clear the input; then stop the session this terminal runs; pressed twice, quit"],
];

/** The width of the column of the names, in columns. */
const NAMES = 16;

/** What the help needs. */
export interface HelpProps {
  readonly theme: Theme;
}

/**
 * The help of the conversation: its commands, then its keys, each with what it does.
 *
 * @param props - The theme.
 * @returns The two lists.
 */
export function Help({ theme }: HelpProps): ReactNode {
  const accent = theme.ink("accent");
  const line = (name: string, does: string): ReactNode =>
    h(Box, { key: name }, h(Box, { width: NAMES, flexShrink: 0 }, h(Text, accent, name)), h(Box, { flexShrink: 1 }, h(Text, null, does)));
  return h(
    Box,
    { flexDirection: "column", marginTop: 1 },
    h(Text, { bold: true }, "Commands"),
    ...SLASH_COMMANDS.map(({ name, takes, does }) => line(`/${name}${takes === undefined ? "" : ` ${takes}`}`, does)),
    h(Box, { marginTop: 1 }, h(Text, { bold: true }, "Keys")),
    ...KEYS.map(([key, does]) => line(key, does)),
  );
}
