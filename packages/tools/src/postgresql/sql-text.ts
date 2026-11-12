import { MAX_VALUE_LENGTH } from "./data-rows.ts";

/**
 * @param columns - The columns to read, each name once.
 * @returns A select list that reads each column as text, cut by the database one character beyond
 * `MAX_VALUE_LENGTH`, so that no value larger than that ever leaves the server.
 */
export function shortTextColumns(columns: readonly string[]): string {
  return columns.map((name) => `left(${sqlIdentifier(name)}::text, ${MAX_VALUE_LENGTH + 1}) AS ${sqlIdentifier(name)}`).join(", ");
}

/**
 * @param name - A name of the database.
 * @returns It as a quoted SQL identifier.
 */
export function sqlIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}
