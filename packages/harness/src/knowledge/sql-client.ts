/** Runs a parameterised SQL query and returns its rows. */
export interface SqlClient {
  /**
   * @param text - The query, with `$1`, `$2`… placeholders.
   * @param values - The values of the placeholders.
   * @returns The rows of the result.
   * @throws Error when the database cannot be reached or refuses the query.
   */
  query(text: string, values: readonly unknown[]): Promise<readonly Record<string, unknown>[]>;
}
