import type pg from "pg";

/** A JSONB column of the schema of the instance. */
export interface JsonbColumn {
  readonly table: string;
  readonly column: string;
}

/**
 * Reads the catalog of a database for the JSONB columns that no GIN index covers by themselves.
 *
 * @param client - A connection to the database, after its migrations.
 * @returns Each such column, as `schema.table` and column name, in a stable order.
 */
export async function jsonbColumnsWithoutGin(client: pg.Client): Promise<JsonbColumn[]> {
  const { rows } = await client.query<JsonbColumn>(`
    select format('%I.%I', n.nspname, c.relname) as table, a.attname as column
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid and c.relkind in ('r', 'p')
    join pg_namespace n on n.oid = c.relnamespace
    where a.atttypid = 'jsonb'::regtype and a.attnum > 0 and not a.attisdropped
      and n.nspname not in ('pg_catalog', 'information_schema', 'drizzle')
      and not exists (
        select 1 from pg_index i
        join pg_class ic on ic.oid = i.indexrelid
        join pg_am am on am.oid = ic.relam and am.amname = 'gin'
        where i.indrelid = c.oid and a.attnum = any (i.indkey::smallint[])
      )
    order by 1, 2`);
  return rows;
}
