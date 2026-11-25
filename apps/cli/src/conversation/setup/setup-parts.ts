import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import { createElement as h, type ReactNode } from "react";
import { Marked } from "../view/marked.ts";
import { GUTTER, type Theme } from "../view/palette.ts";

/** What a field of a setting in the terminal draws, and who hears it. */
export interface SetupField {
  readonly theme: Theme;
  /** What the field asks. */
  readonly label: string;
  /** What helps to answer it. */
  readonly hint: string;
  /** What the field holds. */
  readonly text: string;
  readonly onType: (text: string) => void;
  readonly onEnter: () => void;
  /** What stands for each character typed, for a value not to be shown. */
  readonly mask?: string;
  /** What the last test of the answer found, told over the field. */
  readonly warning?: string;
  /** Why the answer was refused, told under the field. */
  readonly refusal?: string;
}

/**
 * Draws a field of a setting in the terminal: what it asks, what helps, a warning, the input, and why it was refused.
 *
 * @param field - What the field draws, and who hears it.
 * @returns The field.
 */
export function setupField({ theme, label, hint, text, onType, onEnter, mask, warning, refusal }: SetupField): ReactNode {
  return h(
    Box,
    { flexDirection: "column" },
    h(Text, { bold: true }, label),
    h(Text, theme.ink("muted"), hint),
    warning === undefined ? null : h(Text, theme.ink("warn"), warning),
    h(
      Box,
      null,
      h(Box, { width: GUTTER, flexShrink: 0 }, h(Text, { ...theme.ink("accent"), bold: true }, theme.glyphs.prompt)),
      h(TextInput, { value: text, onChange: onType, onSubmit: onEnter, ...(mask === undefined ? {} : { mask }) }),
    ),
    refusal === undefined ? null : h(Text, theme.ink("warn"), refusal),
  );
}

/**
 * Draws the choices of a list of a setting, the one selected pointed at.
 *
 * @param theme - How it is drawn.
 * @param lines - The choices.
 * @param selected - The rank of the one selected.
 * @returns A line per choice.
 */
export function choiceLines(theme: Theme, lines: readonly string[], selected: number): ReactNode[] {
  return lines.map((line, index) =>
    h(Marked, { key: index, mark: index === selected ? theme.glyphs.pointer : "", style: theme.ink("accent") }, h(Text, { bold: index === selected }, line)),
  );
}

/**
 * Draws what a setting waits for, with a spinner.
 *
 * @param theme - How it is drawn.
 * @param text - What it waits for.
 * @returns The line.
 */
export function waitingLine(theme: Theme, text: string): ReactNode {
  return h(Text, theme.ink("accent"), h(Spinner, { type: theme.glyphs.spinner }), ` ${text}`);
}
