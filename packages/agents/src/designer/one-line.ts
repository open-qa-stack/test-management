/**
 * A text on one line, as a title, a heading or a comment holds it: its spaces collapsed, without the full
 * stop it may end with.
 *
 * @param text - The text.
 * @returns The line.
 */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/\.$/, "");
}
