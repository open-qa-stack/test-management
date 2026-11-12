import type { SqlResult } from "./sql-client.ts";

/** Longest text a data tool returns for one value; longer values are cut. */
export const MAX_VALUE_LENGTH = 300;

/** Rows as a data tool returns them. */
export interface DataRows {
  /** Names of the columns, in order. */
  readonly columns: readonly string[];
  /** The rows, as many as were asked for at most, every value as text or `null`. */
  readonly rows: readonly Record<string, unknown>[];
  /** Whether more rows matched than are returned. */
  readonly moreRows: boolean;
  /** Whether at least one value was cut. */
  readonly cutValues: boolean;
}

/**
 * Shapes the rows of a data read for the model: bounded in number, every value short.
 *
 * @remarks
 * The database already sends each value as text of at most `MAX_VALUE_LENGTH + 1` characters, so that a
 * value one character too long tells that it was cut.
 *
 * @param result - What the database returned, fetched one row beyond `limit`.
 * @param limit - Rows to keep.
 * @returns The rows to return.
 */
export function dataRows({ columns, rows }: SqlResult, limit: number): DataRows {
  let cutValues = false;
  const kept = rows.slice(0, limit).map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([column, value]) => {
        if (typeof value !== "string" || value.length <= MAX_VALUE_LENGTH) return [column, value];
        cutValues = true;
        return [column, `${value.slice(0, MAX_VALUE_LENGTH)}…`];
      }),
    ),
  );
  return { columns, rows: kept, moreRows: rows.length > limit, cutValues };
}
