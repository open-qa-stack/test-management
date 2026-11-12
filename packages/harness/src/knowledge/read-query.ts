/** Most rows a data tool returns. */
export const MAX_ROWS = 100;
/** Rows a data tool returns when the agent does not say. */
export const DEFAULT_ROWS = 20;

const READ = /^(select|with)\b/i;

/**
 * Checks that an agent's query is a single read, and makes it a subquery the harness can bound.
 *
 * @remarks
 * The query becomes a subquery, so that it can only be a `SELECT` (or a `WITH` ending in one) and a second
 * statement is a syntax error. The subquery closes on a line of its own, so that a line comment at the end
 * of the query cannot hide what follows. A trailing semicolon is dropped; any other is refused, even in a
 * string. Writes are prevented by the read-only transaction the client runs in, not by this check.
 *
 * @param sql - The agent's query.
 * @returns The query as a subquery named `agent_query`, to put after `FROM`.
 * @throws Error when the query is not a single read.
 */
export function readSubquery(sql: string): string {
  const query = sql.trim().replace(/;\s*$/, "");
  if (!READ.test(query) || query.includes(";")) {
    throw new Error("Only a single SELECT or WITH query, without semicolons, may run.");
  }
  return `(${query}\n) AS agent_query`;
}

/**
 * Bounds the number of rows an agent asks for.
 *
 * @param requested - What the agent asked for, if anything.
 * @returns A whole number between 1 and `MAX_ROWS`.
 */
export function rowLimit(requested: unknown): number {
  return typeof requested === "number" && Number.isInteger(requested) ? Math.min(Math.max(requested, 1), MAX_ROWS) : DEFAULT_ROWS;
}
