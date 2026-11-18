import { Box, Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import type { ConversationContext } from "./conversation-state.ts";
import { t } from "./i18n/i18n.ts";
import type { Theme } from "./palette.ts";

/** What the banner needs. */
export interface BannerProps {
  readonly context: ConversationContext;
  readonly theme: Theme;
}

/**
 * What opens the conversation, in three lines: the product and the project, the test repository — the end of its path when the line is too short for it —, then the
 * environment the sessions are opened against and the database that keeps them.
 *
 * @param props - Where the conversation takes place, and the theme.
 * @returns The banner.
 */
export function Banner({ context, theme }: BannerProps): ReactNode {
  const muted = theme.ink("muted");
  const between = ` ${theme.glyphs.separator} `;
  return h(
    Box,
    { flexDirection: "column" },
    h(Text, null, h(Text, { ...theme.ink("accent"), bold: true }, "Open QA Stack"), h(Text, muted, between), h(Text, { bold: true }, context.project)),
    h(Text, { ...muted, wrap: "truncate-start" }, context.repository),
    h(
      Text,
      muted,
      `${t("banner.environment", { name: context.environment ?? t("banner.onlyEnvironment") })}${between}${t("banner.database", { name: context.database })}`,
    ),
  );
}
