import { Box, Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import { Marked } from "./marked.ts";
import type { Theme } from "./palette.ts";
import type { Block } from "./thread-blocks.ts";
import { t } from "./i18n/i18n.ts";

/** What the scope of a session needs. */
export interface ScopeBlockProps {
  readonly block: Extract<Block, { kind: "scope" }>;
  readonly theme: Theme;
}

/**
 * What the session works on, at the head of its thread: the levels of the pyramid of tests asked, which alone are
 * designed, the applications and the environment, then where the levels are asked.
 *
 * @param props - The block and the theme.
 * @returns The lines.
 */
export function ScopeBlock({ block, theme }: ScopeBlockProps): ReactNode {
  const { step } = block;
  const muted = theme.ink("muted");
  const fact = (label: string, value: string): ReactNode => h(Text, { key: label }, h(Text, muted, `${label}: `), value);
  return h(
    Box,
    { flexDirection: "column", marginTop: 1 },
    h(
      Marked,
      null,
      h(Text, { bold: true }, step.title),
      fact(t("scope.levels"), step.levels.join(", ")),
      fact(t("scope.applications"), step.applications.join(", ")),
      fact(t("scope.environment"), step.environment),
      h(Text, muted, t("scope.note")),
    ),
  );
}
