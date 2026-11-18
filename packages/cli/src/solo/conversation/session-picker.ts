import { Box, Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import { SessionLine } from "./session-line.ts";
import type { Overlay } from "./conversation-state.ts";
import type { Theme } from "./palette.ts";

/** What the picker of a session needs. */
export interface SessionPickerProps {
  readonly picker: Extract<Overlay, { kind: "picker" }>;
  readonly theme: Theme;
}

/**
 * The sessions to pick one from, the latest first, the selected one pointed at.
 *
 * @param props - The sessions, the selection and the theme.
 * @returns The list, under its title.
 */
export function SessionPicker({ picker, theme }: SessionPickerProps): ReactNode {
  return h(
    Box,
    { flexDirection: "column", marginTop: 1 },
    h(Text, { bold: true }, "Reopen a session"),
    ...picker.sessions.map((session, index) => h(SessionLine, { key: session.id, session, selected: index === picker.selected, theme })),
  );
}
