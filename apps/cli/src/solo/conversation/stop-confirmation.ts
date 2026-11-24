import { Box, Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import { t } from "./i18n/i18n.ts";
import type { Theme } from "./palette.ts";

/** What the confirmation of a stop needs. */
export interface StopConfirmationProps {
  /** The identifier of the session to stop. */
  readonly session: string;
  readonly theme: Theme;
}

/**
 * What stands between a person and the stop of a session: what stopping does, so that one key never stops anything.
 *
 * @param props - The session and the theme.
 * @returns The question, and what it means.
 */
export function StopConfirmation({ session, theme }: StopConfirmationProps): ReactNode {
  return h(
    Box,
    { flexDirection: "column", marginTop: 1 },
    h(Text, { ...theme.ink("warn"), bold: true }, t("stop.question", { session })),
    h(Text, null, t("stop.note")),
  );
}
