/** Every table of the database, by schema, without the catalog's own nor those an extension installed. */
export const TABLES_QUERY = `SELECT table_schema AS schema, table_name AS table FROM information_schema.tables
  WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_depend d
      JOIN pg_catalog.pg_class c ON c.oid = d.objid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.deptype = 'e' AND n.nspname = table_schema AND c.relname = table_name
    )
  ORDER BY table_schema, table_name`;

/** The columns of every table, without the catalog's own, table by table and in order. */
export const ALL_COLUMNS_QUERY = `SELECT table_schema AS schema, table_name AS table, column_name AS name, data_type AS type, is_nullable = 'YES' AS nullable
  FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  ORDER BY table_schema, table_name, ordinal_position`;

/** The columns of one table, in order; `$1` is its schema and `$2` its name. */
export const COLUMNS_QUERY = `SELECT column_name AS name, data_type AS type, is_nullable = 'YES' AS nullable FROM information_schema.columns
  WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`;

/**
 * The primary and foreign keys of every table, without the catalog's own: for each, its kind (`p` or `f`),
 * its columns in order and, for a foreign key, the table and columns it references.
 */
export const KEYS_QUERY = `SELECT n.nspname AS schema, c.relname AS table, con.contype AS kind,
    ARRAY(SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, position)
      JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum ORDER BY k.position)::text[] AS columns,
    rn.nspname AS referenced_schema, rc.relname AS referenced_table,
    ARRAY(SELECT a.attname FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, position)
      JOIN pg_catalog.pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum ORDER BY k.position)::text[] AS referenced_columns
  FROM pg_catalog.pg_constraint con
  JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_class rc ON rc.oid = con.confrelid
  LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace
  WHERE con.contype IN ('p', 'f') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  ORDER BY n.nspname, c.relname, con.contype DESC, con.conname`;

/**
 * Every view of the database, materialized or not, without the catalog's own nor those an extension
 * installed: its query as the database writes it, its columns in order, and the tables and views it reads,
 * each as `schema.name`.
 */
export const VIEWS_QUERY = `SELECT n.nspname AS schema, c.relname AS view, c.relkind = 'm' AS materialized,
    pg_catalog.pg_get_viewdef(c.oid, true) AS definition,
    ARRAY(SELECT a.attname FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum)::text[] AS columns,
    ARRAY(SELECT DISTINCT rn.nspname || '.' || rc.relname
      FROM pg_catalog.pg_rewrite r
      JOIN pg_catalog.pg_depend d ON d.classid = 'pg_catalog.pg_rewrite'::regclass AND d.objid = r.oid
        AND d.refclassid = 'pg_catalog.pg_class'::regclass
      JOIN pg_catalog.pg_class rc ON rc.oid = d.refobjid
      JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace
      WHERE r.ev_class = c.oid AND rc.oid <> c.oid AND rc.relkind IN ('r', 'p', 'v', 'm', 'f') ORDER BY 1)::text[] AS reads
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('v', 'm') AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_depend e
      WHERE e.classid = 'pg_catalog.pg_class'::regclass AND e.objid = c.oid AND e.deptype = 'e'
    )
  ORDER BY n.nspname, c.relname`;

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

const ALLOWED = new Set([TABLES_QUERY, COLUMNS_QUERY, ALL_COLUMNS_QUERY, KEYS_QUERY, VIEWS_QUERY, SERVER_ACCESS_QUERY]);

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
