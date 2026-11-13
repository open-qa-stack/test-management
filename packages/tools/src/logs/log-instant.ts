/** A date and a time, ISO 8601 or as most loggers write them: `2026-11-13T10:15:00.123Z`, `2026-11-13 10:15:00,123`. */
const TIMESTAMP = String.raw`(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?)(Z|[+-]\d{2}:?\d{2})?`;
const LINE_START = new RegExp(`^\\[?${TIMESTAMP}`);
const WHOLE = new RegExp(`^${TIMESTAMP}$`);

/**
 * Reads the instant a log line starts with, as engines and most loggers write it, to its last millisecond.
 *
 * @remarks
 * A time without an offset is local time, that of the workstation the service runs on. A timestamp covers
 * the span its precision leaves: `10:15:00` stands for any time until `10:15:00.999`, so that a line stamped
 * to the second is not taken for older than an instant given to the millisecond.
 *
 * @param line - A line of a log.
 * @returns The last instant the timestamp covers, in milliseconds since the epoch; `undefined` when the line
 * does not start with one, as the lines of a stack trace.
 */
export function lineInstant(line: string): number | undefined {
  const match = LINE_START.exec(line);
  return match === null ? undefined : instantOf(match, true);
}

/**
 * Reads an instant an agent gives.
 *
 * @param text - A date and a time, ISO 8601; local time without an offset.
 * @returns The instant, in milliseconds since the epoch.
 * @throws Error when the text is not a date and a time.
 */
export function parseInstant(text: string): number {
  const match = WHOLE.exec(text);
  const instant = match === null ? undefined : instantOf(match, false);
  if (instant === undefined) throw new Error(`${JSON.stringify(text)} is not a date and a time, such as 2026-11-13T10:15:00Z.`);
  return instant;
}

/**
 * The instant a timestamp designates.
 *
 * @param match - The timestamp, as `TIMESTAMP` reads it.
 * @param last - Whether to give the last millisecond its precision covers rather than the first.
 * @returns The instant, or `undefined` when the date does not exist.
 */
function instantOf([, date, time, offset = ""]: RegExpExecArray, last: boolean): number | undefined {
  const instant = Date.parse(`${date!}T${time!.replace(",", ".")}${offset}`);
  if (Number.isNaN(instant)) return undefined;
  return last ? instant + spanOf(time!) - 1 : instant;
}

/** How many milliseconds a time of day covers, given its precision: a minute, a second, or a fraction of one. */
function spanOf(time: string): number {
  const [, seconds, fraction] = /^\d{2}:\d{2}(:\d{2})?(?:[.,](\d+))?$/.exec(time)!;
  if (seconds === undefined) return 60_000;
  return fraction === undefined ? 1000 : Math.max(1, 10 ** (3 - fraction.length));
}
