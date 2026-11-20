import { locale } from "./i18n.ts";

/** Writes a count of a unit of time in the language of the console, such as `3 min` or `1,5 s`. */
function unit(unit: "millisecond" | "second" | "minute", value: number, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(locale(), { style: "unit", unit, unitDisplay: "short", ...options }).format(value);
}

/**
 * Writes a duration as a person reads it.
 *
 * @param milliseconds - The duration.
 * @returns It in seconds under a minute, in minutes and seconds beyond, such as `1 min 05 s`.
 */
export function durationText(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return unit("second", seconds);
  return `${unit("minute", Math.floor(seconds / 60))} ${unit("second", seconds % 60, { minimumIntegerDigits: 2 })}`;
}

/**
 * Writes how long an action took.
 *
 * @param milliseconds - The duration.
 * @returns It in milliseconds under a second, in seconds with a decimal under a minute, as a duration beyond.
 */
export function elapsedText(milliseconds: number): string {
  if (milliseconds < 1000) return unit("millisecond", Math.round(milliseconds));
  return milliseconds < 60_000 ? unit("second", milliseconds / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : durationText(milliseconds);
}

/**
 * Writes a moment to the second, in universal time, as the thread of a session tells it.
 *
 * @param iso - The moment, in ISO 8601.
 * @returns Its day and its time, with the name of the time zone.
 */
export function momentText(iso: string): string {
  return new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "long", timeZone: "UTC" }).format(new Date(iso));
}

/**
 * Writes a date for the person, to the minute, in the time zone of the browser.
 *
 * @param iso - The date, in ISO 8601.
 * @returns Its day, its month abbreviated, its year and its time, such as `19 nov. 2026, 02:16`.
 */
export function dateText(iso: string): string {
  return new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

/**
 * Writes a size as a person reads it, in decimal units: a byte, a kilobyte of a thousand bytes, a megabyte of a
 * million.
 *
 * @param bytes - The size, in bytes.
 * @returns It in bytes, the unit written whole, under a thousand, in kilobytes under a million, in megabytes beyond, to a decimal at most.
 */
export function sizeText(bytes: number): string {
  const [value, size] = bytes < 1000 ? [bytes, "byte"] : bytes < 1_000_000 ? [bytes / 1000, "kilobyte"] : [bytes / 1_000_000, "megabyte"];
  // A count of bytes is written whole, the short name of the unit being the same in the singular and the plural.
  return new Intl.NumberFormat(locale(), { style: "unit", unit: size, unitDisplay: size === "byte" ? "long" : "short", maximumFractionDigits: 1 }).format(
    value,
  );
}
