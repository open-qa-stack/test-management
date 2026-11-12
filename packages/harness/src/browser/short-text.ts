/** Longest text the page controls (title, address, console message) that a tool returns as it is. */
export const MAX_TEXT_LENGTH = 500;

/**
 * Bounds a text the page controls, so that a page cannot flood the model's context.
 *
 * @param text - The text.
 * @returns It, cut to `MAX_TEXT_LENGTH` characters followed by `…` when longer.
 */
export function shortText(text: string): string {
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}…` : text;
}
