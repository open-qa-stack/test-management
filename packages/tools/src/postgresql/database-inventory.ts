import { fingerprintOf } from "../common/fingerprint.ts";
import type { SourceInventory } from "../common/source-inventory.ts";
import type { DatabaseCatalog } from "./database-catalog.ts";

/**
 * Reads what a database holds from its catalog alone, never its rows.
 *
 * @remarks
 * The elements are its tables, as `schema.table`. The facts of each are its number of columns, its
 * primary key and its foreign keys; its excerpt lists its columns, each with its type. The fingerprint
 * covers the tables, their columns and their keys, so that any change of structure changes it.
 *
 * @param catalog - The catalog of the database.
 * @returns The inventory of the database.
 * @throws Error when the database cannot be reached.
 */
export async function databaseInventory(catalog: DatabaseCatalog): Promise<SourceInventory> {
  const [tables, columns, keys] = await Promise.all([catalog.tables(), catalog.allColumns(), catalog.keys()]);
  const items = tables.map((t) => `${t.schema}.${t.table}`);
  const facts = new Map(
    items.map((table) => {
      const key = keys.get(table);
      return [table, { columns: columns.get(table)?.length ?? 0, primaryKey: key?.primaryKey ?? [], foreignKeys: key?.foreignKeys ?? [] }] as const;
    }),
  );
  const excerpts = new Map([...columns].map(([table, listed]) => [table, listed.map((column) => `${column.name} ${column.type}${column.nullable ? "" : " not null"}`).join(", ")] as const));
  return { items, facts, excerpts, fingerprint: fingerprintOf(JSON.stringify({ items, columns: [...columns], keys: [...keys] })) };
}
