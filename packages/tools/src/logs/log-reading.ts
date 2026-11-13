import { redactText } from "../browser/redact.ts";
import { lineInstant } from "./log-instant.ts";
import type { LogLines } from "./log-source.ts";

/** Longest line returned as it is; longer ones are cut and end with `…`. */
export const MAX_LOG_LINE_LENGTH = 2000;
/** Most characters of lines one reading returns. */
export const MAX_LOG_CHARACTERS = 20_000;

/** The escape sequences that colour the text of a terminal, which many services write to their logs. */
const COLOURS = /\u001b\[[0-9;]*m/g;

/** What one reading of a log returns. */
export interface LogReading {
  /** The instant read from, ISO 8601 in UTC. */
  readonly since: string;
  /** The lines written from that instant, in order, secrets masked. */
  readonly lines: readonly string[];
  /** Whether lines written from that instant, and kept by the filter, were left out. */
  readonly truncated: boolean;
}

/** How to choose the lines of a reading. */
export interface LogSelection {
  /** The instant, in milliseconds since the epoch. */
  readonly since: number;
  /** Text a line must contain, ignoring case; every line when absent. */
  readonly filter?: string;
  /** Most lines to return. */
  readonly limit: number;
  /** Values masked in every line, in every form `secretForms` gives. */
  readonly secrets: readonly string[];
}

/**
 * Keeps the lines of a log written from an instant, masked, filtered and bounded.
 *
 * @remarks
 * A line that does not start with a timestamp, as a line of a stack trace, was written with the last one
 * that did; lines before the first timestamp are left out. Colour escapes are removed. The filter applies to
 * the masked line, so that it cannot tell whether a secret is there. The reading stops at `limit` lines or
 * `MAX_LOG_CHARACTERS`.
 *
 * @param log - The lines a source read.
 * @param selection - Which lines to keep.
 * @returns The reading.
 */
export async function readLog(log: LogLines, selection: LogSelection): Promise<LogReading> {
  const needle = selection.filter?.toLowerCase();
  const lines: string[] = [];
  let characters = 0;
  let written: number | undefined;
  let truncated = false;
  for await (const line of log.lines) {
    written = lineInstant(line) ?? written;
    if (written === undefined || written < selection.since) continue;
    const masked = redactText(line.replace(COLOURS, ""), selection.secrets);
    if (needle !== undefined && !masked.toLowerCase().includes(needle)) continue;
    const text = masked.length > MAX_LOG_LINE_LENGTH ? `${masked.slice(0, MAX_LOG_LINE_LENGTH)}…` : masked;
    if (lines.length === selection.limit || characters + text.length > MAX_LOG_CHARACTERS) {
      truncated = true;
      break;
    }
    lines.push(text);
    characters += text.length;
  }
  return { since: new Date(selection.since).toISOString(), lines, truncated: truncated || log.cut };
}
