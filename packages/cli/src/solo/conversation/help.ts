import { Box, Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import { t } from "./i18n/i18n.ts";
import { SLASH_COMMANDS } from "./slash-commands.ts";
import type { Theme } from "./palette.ts";

/** The keys of the conversation, and what each does, in the language of the conversation. */
function keys(): readonly (readonly [string, string])[] {
  return [
    ["Enter", t("help.enter")],
    ["Tab", t("help.tab")],
    [t("help.keyUpDown"), t("help.upDown")],
    ["Esc", t("help.esc")],
    ["Ctrl-C", t("help.ctrlC")],
  ];
}

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
    h(Text, { bold: true }, t("help.commands")),
    ...SLASH_COMMANDS.map(({ name, takes }) => line(`/${name}${takes === undefined ? "" : ` ${takes}`}`, t(`commands.${name}`))),
    h(Box, { marginTop: 1 }, h(Text, { bold: true }, t("help.keys"))),
    ...keys().map(([key, does]) => line(key, does)),
  );
}
