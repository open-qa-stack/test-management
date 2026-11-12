/** Every table of the database, by schema, without the catalog's own. */
export const TABLES_QUERY = `SELECT table_schema AS schema, table_name AS table FROM information_schema.tables
  WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')
  ORDER BY table_schema, table_name`;

/** The columns of one table, in order; `$1` is its schema and `$2` its name. */
export const COLUMNS_QUERY = `SELECT column_name AS name, data_type AS type, is_nullable = 'YES' AS nullable FROM information_schema.columns
  WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`;

/**
 * Whether the role of the connection can reach the database server itself: a superuser, or a member of
 * a predefined role that reads or writes its files or runs its programs.
 */
export const SERVER_ACCESS_QUERY = `SELECT r.rolsuper OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles p
    WHERE p.rolname IN ('pg_read_server_files', 'pg_write_server_files', 'pg_execute_server_program')
      AND pg_catalog.pg_has_role(r.oid, p.oid, 'MEMBER')
  ) AS server_access
  FROM pg_catalog.pg_roles r WHERE r.rolname = current_user`;

const ALLOWED = new Set([TABLES_QUERY, COLUMNS_QUERY, SERVER_ACCESS_QUERY]);

/**
 * Refuses any query but the fixed catalog queries.
 *
 * @remarks
 * The catalog tools only ever need these queries, so the guard allows exactly them instead of trying to
 * recognise safe SQL. Values reach the database as parameters, never in the text.
 *
 * @param text - The query.
 * @throws Error when the query is not one of the catalog queries.
 */
export function assertCatalogQuery(text: string): void {
  if (!ALLOWED.has(text)) throw new Error("Only the catalog queries of the database tools may run.");
}
