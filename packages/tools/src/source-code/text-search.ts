/** Longest line a search returns as it is; longer ones are cut. */
export const MAX_LINE_LENGTH = 300;

/** A numbered line of a file. */
export interface NumberedLine {
  /** Number of the line, from 1. */
  readonly line: number;
  /** Its text, cut when long. */
  readonly text: string;
}

/** A line that matches a search, with the lines around it. */
export interface SearchMatch {
  /** Path of the file, relative to the folder. */
  readonly path: string;
  /** Number of the matching line. */
  readonly line: number;
  /** The matching line and its context, in order. */
  readonly lines: readonly NumberedLine[];
}

/**
 * Finds the lines of a text that match a pattern.
 *
 * @param path - Path of the file, to put in each match.
 * @param text - Text of the file.
 * @param pattern - What to find, tested on each line.
 * @param context - Lines to give before and after each match.
 * @param limit - Most matches to return.
 * @returns The matches, in the order of the file.
 */
export function searchText(path: string, text: string, pattern: RegExp, context: number, limit: number): SearchMatch[] {
  const lines = fileLines(text);
  const matches: SearchMatch[] = [];
  for (let i = 0; i < lines.length && matches.length < limit; i++) {
    if (!pattern.test(lines[i]!)) continue;
    const from = Math.max(0, i - context);
    matches.push({ path, line: i + 1, lines: numberedLines(lines.slice(from, i + context + 1), from + 1, MAX_LINE_LENGTH) });
  }
  return matches;
}

/**
 * Splits the text of a file into its lines, the way editors and git number them.
 *
 * @param text - The text.
 * @returns Its lines, without their line ends; a final line end does not open an empty last line.
 */
export function fileLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
}

/**
 * Numbers lines and cuts the long ones.
 *
 * @param lines - Consecutive lines of a file.
 * @param first - Number of the first one.
 * @param maxLength - Longest line kept as it is; longer ones are cut and end with `…`.
 * @returns The numbered lines.
 */
export function numberedLines(lines: readonly string[], first: number, maxLength: number): NumberedLine[] {
  return lines.map((text, i) => ({ line: first + i, text: text.length > maxLength ? `${text.slice(0, maxLength)}…` : text }));
}
