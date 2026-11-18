import type { ColumnType } from "kysely";

/**
 * A date in a column. PostgreSQL keeps it as a `timestamptz`, which its client reads as a `Date`; SQLite keeps
 * the text it is given. It is written as the same text on both: ISO 8601, in UTC, to the millisecond, which
 * sorts as the dates do.
 */
export type StoredInstant = ColumnType<Date | string, string, string>;

/**
 * A JSON value in a column. PostgreSQL keeps it as `json`, which its client reads parsed; SQLite keeps the text
 * it is given. It is written as the same text on both, which keeps the fields in the order they were given.
 */
export type StoredJson<Value> = ColumnType<Value | string, string, string>;

/**
 * A boolean in a column, which the database fills by itself: a `boolean` on PostgreSQL, the integer 0 or 1 on
 * SQLite.
 */
export type StoredBoolean = ColumnType<boolean | number, never, never>;

/**
 * Writes a date as the columns keep it, and reads one a column kept: this is where the two databases meet.
 *
 * @param date - The date to write, or what a column gave: a `Date` on PostgreSQL, the text on SQLite.
 * @returns The date in ISO 8601, in UTC, to the millisecond.
 * @throws `RangeError` when the text is no date: nothing but a date is ever kept as one.
 */
export function instant(date: Date | string): string {
  return new Date(date).toISOString();
}

/**
 * Writes a JSON value as the columns keep it.
 *
 * @param value - The value.
 * @returns Its JSON text.
 */
export function storedJson(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Reads a JSON value a column kept.
 *
 * @param stored - What the column gave: the value on PostgreSQL, its text on SQLite. The columns keep objects
 * and arrays only, so a text is never the value itself.
 * @returns The value.
 */
export function jsonOf<Value>(stored: Value | string): Value {
  return typeof stored === "string" ? (JSON.parse(stored) as Value) : stored;
}
