/** What a person changes of a test: its own title, or the text of one of its steps, by its number from 1. */
export type TestEdit = { readonly title: string } | { readonly step: number; readonly text: string };

/** A change to a test of the test repository, as `PATCH /tests` takes it. */
export interface TestChange {
  /** The path of its file, relative to the root of the test repository. */
  readonly path: string;
  /** Its titles, as `GET /tests` gives them: `<describe>… › <title>`. */
  readonly title: string;
  /** What changes. */
  readonly change: TestEdit;
}

/** The source of a file of tests, as `GET /tests/source` answers. */
export interface TestSource {
  /** Its path, relative to the root of the test repository. */
  readonly path: string;
  /** Its text, as it is now. */
  readonly content: string;
}

/** The longest title or step text a person may write, in characters. */
export const MAX_TEST_TEXT = 300;

/** What numbers a step the harness writes, such as `2. ` in `2. Search the order`. */
const NUMBERED = /^(\d+\.\s+)([\s\S]*)$/;

/**
 * A step as a person reads it: the number the harness writes before it, apart, and its text.
 *
 * @param title - The title of the step, as its file writes it.
 * @returns The number the title starts with, with its point and its space, or `""`; then the rest of the title.
 */
export function stepWording(title: string): { readonly number: string; readonly text: string } {
  const [, number, text] = NUMBERED.exec(title) ?? [];
  return number === undefined ? { number: "", text: title } : { number, text: text! };
}

/**
 * Why a text a person wrote for a title or a step cannot be written: an empty one, one of several lines, or one too long.
 *
 * @param text - The text, trimmed.
 * @returns The reason, in a sentence; `undefined` when it can be written.
 */
export function textRefusal(text: string): string | undefined {
  if (text === "") return "The text is empty.";
  if (/[\r\n]/.test(text)) return "The text holds a line break: a title or a step is one line.";
  if (text.length > MAX_TEST_TEXT) return `The text is longer than ${MAX_TEST_TEXT} characters.`;
  return undefined;
}
