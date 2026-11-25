import { cleanup, render } from "ink-testing-library";
import { createElement } from "react";
import { ConversationView } from "../../../src/conversation/view/conversation-view.ts";
import { themeOf, type Theme } from "../../../src/conversation/view/palette.ts";
import type { ConversationState } from "../../../src/conversation/state/conversation-state.ts";
import { CONTEXT } from "./fixtures.ts";

/** A terminal that reads UTF-8 and draws colours. */
export const UNICODE: Theme = themeOf({ LANG: "en_US.UTF-8", TERM: "xterm-256color" });

/** A terminal that draws ASCII alone, without colour. */
export const PLAIN: Theme = themeOf({ LANG: "C", NO_COLOR: "1" });

/** The widths the screens are drawn at: a comfortable terminal, and the narrowest the conversation is laid out for. */
export const WIDTHS = [100, 60] as const;

/**
 * Draws the screen of a conversation.
 *
 * @param state - The conversation.
 * @param width - The width of the terminal, in columns.
 * @param theme - How it is drawn; with glyphs and colours by default.
 * @returns The screen as a person reads it, the scrollback first, line by line.
 */
export function screenOf(state: ConversationState, width: number, theme: Theme = UNICODE): string[] {
  const { lastFrame } = render(
    createElement(ConversationView, { state, context: CONTEXT, theme, width, onChange: () => undefined, onSubmit: () => undefined }),
  );
  const lines = String(lastFrame()).split("\n");
  cleanup();
  return lines;
}

/**
 * Counts the columns a line takes.
 *
 * @param line - A line of a screen, of characters a column wide.
 * @returns Its width, in characters as a person sees them.
 */
export function widthOf(line: string): number {
  return [...new Intl.Segmenter().segment(line)].length;
}

/**
 * Waits for something to hold.
 *
 * @param holds - Tells whether it holds yet.
 * @param what - What is waited for, told when it does not come.
 */
export async function until(holds: () => boolean, what: string): Promise<void> {
  const startedAt = Date.now();
  while (!holds()) {
    if (Date.now() - startedAt > 20_000) throw new Error(`Not seen in time: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** A screen drawn in a terminal of the tests, as a person reads it and types in it. */
export interface Staged {
  /** The screen as a person reads it. */
  readonly screen: () => string;
  /** Waits for a text to be on the screen. */
  readonly sees: (seen: string | RegExp) => Promise<void>;
  /** Presses keys, then waits for a text to be on the screen. */
  readonly press: (keys: string, seen: string | RegExp) => Promise<void>;
}

/**
 * Reads and types in what `render` of `ink-testing-library` drew.
 *
 * @param lastFrame - What was drawn last.
 * @param stdin - Where the keys are typed.
 * @returns The screen, and how to wait for a text and to press keys: Ink reads a key once it drew, so each waits for the screen to settle.
 */
export function staging(lastFrame: () => string | undefined, stdin: { write(data: string): void }): Staged {
  const screen = (): string => String(lastFrame());
  const sees = (seen: string | RegExp): Promise<void> =>
    until(() => (typeof seen === "string" ? screen().includes(seen) : seen.test(screen())), `${String(seen)}\n${screen()}`);
  const press = async (keys: string, seen: string | RegExp): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write(keys);
    await sees(seen);
  };
  return { screen, sees, press };
}
