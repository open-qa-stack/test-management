import { exportFile, sourceExport, type ElementDraft, type SourceExport } from "../common/source-export.ts";
import type { ColumnSummary, DatabaseStructure, TableKeys } from "./database-catalog.ts";

/**
 * Exports the structure of a database, element by element.
 *
 * @remarks
 * The elements are its tables, as `schema.table`, in the order of the catalog. PostgreSQL keeps no text of
 * a table: its definition is written again from the catalog — its columns, each with its type and whether
 * it may be null, its primary key and its foreign keys — with the names as the catalog gives them, unquoted.
 * It is there to be read, not run. The names of a table are its columns and its links the other tables its
 * foreign keys reference.
 *
 * @param structure - What the catalog gives of the database.
 * @returns The export of the database.
 */
export function databaseExport(structure: DatabaseStructure): SourceExport {
  return sourceExport(
    structure.tables.map(({ schema, table }) => {
      const name = `${schema}.${table}`;
      return tableElement(name, structure.columns.get(name) ?? [], structure.keys.get(name));
    }),
  );
}

/**
 * Lists columns on one line.
 *
 * @param columns - The columns of a table, in order.
 * @returns Each with its type, and `not null` when it accepts no `NULL`.
 */
export function columnList(columns: readonly ColumnSummary[]): string {
  return columns.map((column) => `${column.name} ${column.type}${column.nullable ? "" : " not null"}`).join(", ");
}

/** A table, as an element of the export. */
function tableElement(name: string, columns: readonly ColumnSummary[], keys: TableKeys | undefined): ElementDraft {
  const primaryKey = keys?.primaryKey ?? [];
  const foreignKeys = keys?.foreignKeys ?? [];
  const clauses = [
    ...columns.map((column) => `${column.name} ${column.type}${column.nullable ? "" : " NOT NULL"}`),
    ...(primaryKey.length === 0 ? [] : [`PRIMARY KEY (${primaryKey.join(", ")})`]),
    ...foreignKeys.map((key) => `FOREIGN KEY (${key.columns.join(", ")}) REFERENCES ${key.references} (${key.referencedColumns.join(", ")})`),
  ];
  const summary = [
    `table ${name}`,
    ...(columns.length === 0 ? [] : [`columns: ${columnList(columns)}`]),
    ...(primaryKey.length === 0 ? [] : [`primary key: ${primaryKey.join(", ")}`]),
    ...(foreignKeys.length === 0
      ? []
      : [`foreign keys: ${foreignKeys.map((key) => `${key.columns.join(", ")} -> ${key.references} (${key.referencedColumns.join(", ")})`).join("; ")}`]),
  ];
  return {
    name,
    kind: "table",
    summary: summary.join("\n  "),
    definition: `CREATE TABLE ${name} (${clauses.map((clause) => `\n  ${clause}`).join(",")}\n);`,
    names: columns.map((column) => column.name),
    links: [...new Set(foreignKeys.map((key) => key.references))].filter((referenced) => referenced !== name),
    file: exportFile("tables", name, "sql"),
  };
}
