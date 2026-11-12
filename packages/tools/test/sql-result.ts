import type { SqlResult } from "../src/index.ts";

/**
 * @param rows - Rows of a query result.
 * @param columns - Its columns; the keys of the first row when absent.
 * @returns The result a SqlClient gives for these rows.
 */
export function sqlResult(rows: readonly Record<string, unknown>[], columns: readonly string[] = Object.keys(rows[0] ?? {})): SqlResult {
  return { columns, rows };
}
