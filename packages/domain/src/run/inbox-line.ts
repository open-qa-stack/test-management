import { isRecord, parseJson } from "../json.ts";

/**
 * Writes a message of a person as a line of the inbox of a run: one message a line,
 * `{ "at": "<ISO 8601 date>", "text": "<what the person says>" }`.
 *
 * @param at - When the person sent it, as an ISO 8601 date.
 * @param text - What the person says.
 * @returns The line, without its end.
 */
export function inboxLineOf(at: string, text: string): string {
  return JSON.stringify({ at, text });
}

/** A message read from a line of the inbox of a run. */
export interface InboxMessage {
  /** What the person says. */
  readonly text: string;
  /** When the person sent it, as the line gives it, which may be anything: a run does not read it. */
  readonly at: unknown;
}

/**
 * Reads a line of the inbox of a run.
 *
 * @remarks
 * A run reads the text of a line alone, and numbers every line, a message or not: a number always names the
 * same line.
 *
 * @param line - The line, as it was appended.
 * @returns The message; `undefined` for a line that is none: a text that is no JSON object, or one that says nothing.
 */
export function inboxMessage(line: string): InboxMessage | undefined {
  const value = parseJson(line);
  if (!isRecord(value)) return undefined;
  const { text, at } = value;
  return typeof text === "string" && text.trim() !== "" ? { text, at } : undefined;
}
