import { exportFile, sourceExport, type ElementDraft, type SourceExport } from "../common/source-export.ts";
import type { ColumnSummary, DatabaseStructure, NamedDefinition, RoutineSummary, TableKeys, TriggerSummary, ViewSummary } from "./database-catalog.ts";

/**
 * Exports the structure of a database, element by element.
 *
 * @remarks
 * The elements are its tables, then its views, each as `schema.name`, then its functions and procedures,
 * each as `schema.name(arguments)` so that two routines of one name stay apart, all in the order of the catalog.
 * PostgreSQL keeps no text of a table: its definition is written again from the catalog — its columns, each
 * with its whole type, its default and whether it may be null, its primary key, its foreign keys, its
 * unique, check and exclusion constraints, then the indexes no constraint made — with the names as the
 * catalog gives them, unquoted. It is there to be read, not run. The names of a table are its columns and
 * its links the other tables its foreign keys reference. The definition of a view is its query as the
 * database writes it, its names are its columns and its links the tables and views it reads. The triggers
 * of a table or of a view are no elements: the definition of each follows that of its table, whose summary
 * names it and whose links gain the routine it runs. The definition of a routine is the one the database
 * writes, and its names are its parameters.
 *
 * @param structure - What the catalog gives of the database.
 * @returns The export of the database.
 */
export function databaseExport(structure: DatabaseStructure): SourceExport {
  return sourceExport([
    ...structure.tables.map(({ schema, table }) => {
      const name = `${schema}.${table}`;
      const element = tableElement(name, structure.columns.get(name) ?? [], structure.keys.get(name), structure.constraints.get(name));
      return withTriggers(withIndexes(element, structure.indexes.get(name)), structure.triggers.get(name));
    }),
    ...structure.views.map((view) => withTriggers(withIndexes(viewElement(view), structure.indexes.get(view.view)), structure.triggers.get(view.view))),
    ...structure.routines.map(routineElement),
  ]);
}

/** Columns on one line: each with its type, and `not null` when it accepts no `NULL`. */
function columnList(columns: readonly ColumnSummary[]): string {
  return columns.map((column) => `${column.name} ${column.type}${column.nullable ? "" : " not null"}`).join(", ");
}

/** A table, as an element of the export. */
function tableElement(
  name: string,
  columns: readonly ColumnSummary[],
  keys: TableKeys | undefined,
  constraints: readonly NamedDefinition[] = [],
): ElementDraft {
  const primaryKey = keys?.primaryKey ?? [];
  const foreignKeys = keys?.foreignKeys ?? [];
  const clauses = [
    ...columns.map((column) => `${column.name} ${column.type}${column.default === undefined ? "" : ` ${column.default}`}${column.nullable ? "" : " NOT NULL"}`),
    ...(primaryKey.length === 0 ? [] : [`PRIMARY KEY (${primaryKey.join(", ")})`]),
    ...foreignKeys.map((key) => `FOREIGN KEY (${key.columns.join(", ")}) REFERENCES ${key.references} (${key.referencedColumns.join(", ")})`),
    ...constraints.map((constraint) => `CONSTRAINT ${constraint.name} ${constraint.definition}`),
  ];
  const summary = [
    `table ${name}`,
    ...(columns.length === 0 ? [] : [`columns: ${columnList(columns)}`]),
    ...(primaryKey.length === 0 ? [] : [`primary key: ${primaryKey.join(", ")}`]),
    ...(foreignKeys.length === 0
      ? []
      : [`foreign keys: ${foreignKeys.map((key) => `${key.columns.join(", ")} -> ${key.references} (${key.referencedColumns.join(", ")})`).join("; ")}`]),
    ...(constraints.length === 0 ? [] : [`constraints: ${constraints.map((constraint) => constraint.definition).join("; ")}`]),
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

/** A view, as an element of the export. */
function viewElement(view: ViewSummary): ElementDraft {
  const kind = view.materialized ? "materialized view" : "view";
  const summary = [
    `${kind} ${view.view}`,
    ...(view.columns.length === 0 ? [] : [`columns: ${view.columns.join(", ")}`]),
    ...(view.reads.length === 0 ? [] : [`reads: ${view.reads.join(", ")}`]),
  ];
  return {
    name: view.view,
    kind: "view",
    summary: summary.join("\n  "),
    definition: `CREATE ${kind.toUpperCase()} ${view.view} AS\n${view.definition}`,
    names: view.columns,
    links: view.reads,
    file: exportFile("views", view.view, "sql"),
  };
}

/** A table or a materialized view with its indexes: their definitions after its own, their names in its summary. */
function withIndexes(element: ElementDraft, indexes: readonly NamedDefinition[] = []): ElementDraft {
  if (indexes.length === 0) return element;
  return {
    ...element,
    summary: `${element.summary}\n  indexes: ${indexes.map((index) => index.name).join(", ")}`,
    definition: `${element.definition}${indexes.map((index) => `\n\n${index.definition};`).join("")}`,
  };
}

/** A table or a view with its triggers: their definitions after its own, their names in its summary, their routines among its links. */
function withTriggers(element: ElementDraft, triggers: readonly TriggerSummary[] = []): ElementDraft {
  if (triggers.length === 0) return element;
  return {
    ...element,
    summary: `${element.summary}\n  triggers: ${triggers.map((trigger) => `${trigger.name} -> ${trigger.routine}`).join("; ")}`,
    definition: `${element.definition}${triggers.map((trigger) => `\n\n${trigger.definition};`).join("")}`,
    links: [...new Set([...element.links, ...triggers.map((trigger) => trigger.routine)])],
  };
}

/** A function or a procedure, as an element of the export. */
function routineElement(routine: RoutineSummary): ElementDraft {
  return {
    name: routine.routine,
    kind: "routine",
    summary: routine.returns === undefined ? `procedure ${routine.routine}` : `function ${routine.routine} returns ${routine.returns}`,
    definition: routine.definition.trimEnd(),
    names: routine.parameters,
    links: [],
    file: exportFile("routines", routine.routine, "sql"),
  };
}
