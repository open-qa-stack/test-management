import type { SourceInventory } from "../common/source-inventory.ts";
import type { DatabaseCatalog, DatabaseStructure } from "./database-catalog.ts";
import { databaseExport } from "./database-export.ts";

/**
 * Reads what a database holds from its catalog alone, never its rows.
 *
 * @remarks
 * The catalog is read once, and gives both the export of the database and its inventory. The elements are
 * its tables, then its views, each as `schema.name`; its routines are in the export only. The facts of a
 * table are its kind, its number of columns, its primary key and its foreign keys; those of a view its
 * kind, its number of columns and the tables and views it reads; either has the names of its triggers when
 * it has some. The fingerprint is that of the export, routines included, so that any change of structure
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
    return [name, { ...facts, ...triggerFacts(structure, name) }] as const;
  });
  const views = structure.views.map(
    (view) => [view.view, { kind: "view", columns: view.columns.length, reads: view.reads, ...triggerFacts(structure, view.view) }] as const,
  );
  const facts = new Map<string, Readonly<Record<string, unknown>>>([...tables, ...views]);
  return { items: [...facts.keys()], facts, fingerprint: exported.fingerprint, export: exported };
}

/** The names of the triggers of a table or a view, as a fact, when it has some. */
function triggerFacts(structure: DatabaseStructure, relation: string): { triggers?: string[] } {
  const triggers = structure.triggers.get(relation);
  return triggers === undefined ? {} : { triggers: triggers.map((trigger) => trigger.name) };
}
