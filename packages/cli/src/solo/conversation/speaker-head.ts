import { Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import type { Speaker } from "@open-qa-stack/domain/sessions";
import { Marked } from "./marked.ts";
import { identityOf } from "./speakers.ts";
import type { Theme } from "./palette.ts";

/** What the head of a speaker needs. */
export interface SpeakerHeadProps {
  readonly speaker: Speaker;
  /** What follows the name on its line, such as whom the harness hands over to. */
  readonly after?: string;
  readonly theme: Theme;
}

/**
 * Who speaks, at the head of what they say and do: their mark in the gutter and their name, in their tone.
 *
 * @param props - The speaker, what follows its name, and the theme.
 * @returns The line.
 */
export function SpeakerHead({ speaker, after, theme }: SpeakerHeadProps): ReactNode {
  const { name, mark, ascii, tone } = identityOf(speaker);
  const style = theme.ink(tone);
  return h(
    Marked,
    { mark: theme.unicode ? mark : ascii, style },
    h(Text, null, h(Text, { ...style, bold: true }, name), after === undefined ? null : h(Text, theme.ink("muted"), ` ${after}`)),
  );
}
