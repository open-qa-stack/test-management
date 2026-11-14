import type { SourceInventory } from "../common/source-inventory.ts";
import type { DatabaseCatalog } from "./database-catalog.ts";
import { columnList, databaseExport } from "./database-export.ts";

/**
 * Reads what a database holds from its catalog alone, never its rows.
 *
 * @remarks
 * The catalog is read once, and gives both the export of the database and its inventory. The elements are
 * its tables, then its views, each as `schema.name`. The facts of a table are its kind, its number of
 * columns, its primary key and its foreign keys; those of a view its kind, its number of columns and the
 * tables and views it reads. The excerpt of an element lists its columns, each with its type, when
 * `information_schema` gives them. The fingerprint is that of the export, so that any change of structure
 * changes it.
 *
 * @param catalog - The catalog of the database.
 * @returns The inventory of the database, with its export.
 * @throws Error when the database cannot be reached.
 */
export async function databaseInventory(catalog: DatabaseCatalog): Promise<SourceInventory> {
  const structure = await catalog.structure();
  const exported = databaseExport(structure);
  const tables = structure.tables.map(({ schema, table }) => {
    const name = `${schema}.${table}`;
    const key = structure.keys.get(name);
    const facts = { kind: "table", columns: structure.columns.get(name)?.length ?? 0, primaryKey: key?.primaryKey ?? [], foreignKeys: key?.foreignKeys ?? [] };
    return [name, facts] as const;
  });
  const views = structure.views.map((view) => [view.view, { kind: "view", columns: view.columns.length, reads: view.reads }] as const);
  const excerpts = new Map([...structure.columns].map(([relation, listed]) => [relation, columnList(listed)] as const));
  return {
    items: exported.elements.map((element) => element.name),
    facts: new Map<string, Readonly<Record<string, unknown>>>([...tables, ...views]),
    excerpts,
    fingerprint: exported.fingerprint,
    export: exported,
  };
}
