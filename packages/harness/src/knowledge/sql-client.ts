/** What a query returned: its columns, in order, and its rows. */
export interface SqlResult {
  /** Names of the columns, in the order of the query, repeated names included. */
  readonly columns: readonly string[];
  /** The rows, keyed by column name. */
  readonly rows: readonly Record<string, unknown>[];
}

/** Runs a parameterised SQL query and returns its result. */
export interface SqlClient {
  /**
   * @param text - The query, with `$1`, `$2`… placeholders.
   * @param values - The values of the placeholders.
   * @returns The columns and rows of the result.
   * @throws Error when the database cannot be reached or refuses the query.
   */
  query(text: string, values: readonly unknown[]): Promise<SqlResult>;
}
