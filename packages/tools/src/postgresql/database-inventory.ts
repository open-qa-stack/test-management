import type { SourceInventory } from "../common/source-inventory.ts";
import type { DatabaseCatalog } from "./database-catalog.ts";
import { columnList, databaseExport } from "./database-export.ts";

/**
 * Reads what a database holds from its catalog alone, never its rows.
 *
 * @remarks
 * The catalog is read once, and gives both the export of the database and its inventory. The elements are
 * its tables, as `schema.table`. The facts of each are its number of columns, its primary key and its
 * foreign keys; its excerpt lists its columns, each with its type. The fingerprint is that of the export,
 * so that any change of structure changes it.
 *
 * @param catalog - The catalog of the database.
 * @returns The inventory of the database, with its export.
 * @throws Error when the database cannot be reached.
 */
export async function databaseInventory(catalog: DatabaseCatalog): Promise<SourceInventory> {
  const structure = await catalog.structure();
  const exported = databaseExport(structure);
  const items = structure.tables.map((t) => `${t.schema}.${t.table}`);
  const facts = new Map(
    items.map((table) => {
      const key = structure.keys.get(table);
      return [table, { columns: structure.columns.get(table)?.length ?? 0, primaryKey: key?.primaryKey ?? [], foreignKeys: key?.foreignKeys ?? [] }] as const;
    }),
  );
  const excerpts = new Map([...structure.columns].map(([table, listed]) => [table, columnList(listed)] as const));
  return { items, facts, excerpts, fingerprint: exported.fingerprint, export: exported };
}
