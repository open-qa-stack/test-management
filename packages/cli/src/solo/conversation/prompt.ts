import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { createElement as h, type ReactNode } from "react";
import { GUTTER, type Theme } from "./palette.ts";

/** What the input needs. */
export interface PromptProps {
  /** What it holds. */
  readonly value: string;
  /** Changes when what it holds was set from outside, so that its cursor goes to its end. */
  readonly epoch: number;
  /** What it says while it is empty. */
  readonly placeholder: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly theme: Theme;
}

/**
 * Where the person types, at the bottom of the screen: the prompt in the gutter, then the input, and after its
 * cursor what it asks for while it is empty.
 *
 * @param props - What the input holds, what it says when empty, what hears it, and the theme.
 * @returns The line.
 */
export function Prompt({ value, epoch, placeholder, onChange, onSubmit, theme }: PromptProps): ReactNode {
  return h(
    Box,
    null,
    h(Box, { width: GUTTER, flexShrink: 0 }, h(Text, { ...theme.ink("accent"), bold: true }, theme.glyphs.prompt)),
    // The input would draw what it says when empty in a colour of its own: it is drawn here, muted as the theme mutes.
    h(
      Box,
      { flexGrow: 1, flexShrink: 1 },
      h(TextInput, { key: epoch, value, onChange, onSubmit }),
      value === "" ? h(Text, theme.ink("muted"), placeholder) : null,
    ),
  );
}
