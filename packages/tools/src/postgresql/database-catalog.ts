import {
  ALL_COLUMNS_QUERY,
  assertCatalogQuery,
  COLUMNS_QUERY,
  KEYS_QUERY,
  ROUTINES_QUERY,
  SERVER_ACCESS_QUERY,
  TABLES_QUERY,
  TRIGGERS_QUERY,
  VIEWS_QUERY,
} from "./catalog-query.ts";
import type { SqlClient } from "./sql-client.ts";

/** A table of the database, as the list tool shows it. */
export interface TableSummary {
  /** Schema the table belongs to. */
  readonly schema: string;
  /** Name of the table. */
  readonly table: string;
}

/** A column of a table. */
export interface ColumnSummary {
  /** Name of the column. */
  readonly name: string;
  /** SQL type of the column, as the catalog names it. */
  readonly type: string;
  /** Whether the column accepts `NULL`. */
  readonly nullable: boolean;
}

/** A foreign key of a table. */
export interface ForeignKey {
  /** Its columns, in order. */
  readonly columns: readonly string[];
  /** The table it references, as `schema.table`. */
  readonly references: string;
  /** The columns it references, in the same order. */
  readonly referencedColumns: readonly string[];
}

/** The keys of a table. */
export interface TableKeys {
  /** The table, as `schema.table`. */
  readonly table: string;
  /** Columns of its primary key, in order; none when it has no primary key. */
  readonly primaryKey: readonly string[];
  /** Its foreign keys. */
  readonly foreignKeys: readonly ForeignKey[];
}

/** A view of the database, materialized or not. */
export interface ViewSummary {
  /** The view, as `schema.view`. */
  readonly view: string;
  /** Whether the database keeps its rows. */
  readonly materialized: boolean;
  /** Its query, as the database writes it. */
  readonly definition: string;
  /** Names of its columns, in order. */
  readonly columns: readonly string[];
  /** The tables and views it reads, each as `schema.name`. */
  readonly reads: readonly string[];
}

/** A function or a procedure of the database. */
export interface RoutineSummary {
  /**
   * The routine, as `schema.name(arguments)`: its arguments, each with its name when it has one and its
   * type, tell it from the others of its name.
   */
  readonly routine: string;
  /** What a function returns; absent for a procedure. */
  readonly returns?: string;
  /** Its definition, as the database writes it. */
  readonly definition: string;
  /** Names of its parameters, in order. */
  readonly parameters: readonly string[];
}

/** A trigger of a table or of a view. */
export interface TriggerSummary {
  /** Name of the trigger. */
  readonly name: string;
  /** Its definition, as the database writes it. */
  readonly definition: string;
  /** The routine it runs, named as a `RoutineSummary` names it. */
  readonly routine: string;
}

/** The structure of a database, read at once. */
export interface DatabaseStructure {
  /** Its tables, in the order of the catalog. */
  readonly tables: readonly TableSummary[];
  /** The columns of each table, in order, by `schema.table`. */
  readonly columns: ReadonlyMap<string, readonly ColumnSummary[]>;
  /** The keys of each table that has some, by `schema.table`. */
  readonly keys: ReadonlyMap<string, TableKeys>;
  /** Its views, in the order of the catalog. */
  readonly views: readonly ViewSummary[];
  /** Its functions and procedures, in the order of the catalog. */
  readonly routines: readonly RoutineSummary[];
  /** The triggers of each table or view that has some, by `schema.name`. */
  readonly triggers: ReadonlyMap<string, readonly TriggerSummary[]>;
}

/** Reads the structure of a database, never its rows. */
export class DatabaseCatalog {
  private readonly client: SqlClient;

  /** @param client - Where the queries run. */
  public constructor(client: SqlClient) {
    this.client = client;
  }

  /**
   * @returns The tables of the database, without the catalog's own nor those an extension installed.
   * @throws Error when the database cannot be reached.
   */
  public async tables(): Promise<TableSummary[]> {
    const rows = await this.read(TABLES_QUERY, []);
    return rows.map((row) => ({ schema: String(row["schema"]), table: String(row["table"]) }));
  }

  /**
   * @param schema - Schema of the table.
   * @param table - Name of the table.
   * @returns Its columns, in order; none when the table does not exist.
   * @throws Error when the database cannot be reached.
   */
  public async columns(schema: string, table: string): Promise<ColumnSummary[]> {
    const rows = await this.read(COLUMNS_QUERY, [schema, table]);
    return rows.map((row) => ({ name: String(row["name"]), type: String(row["type"]), nullable: row["nullable"] === true }));
  }

  /**
   * Reads the columns of every table at once.
   *
   * @returns The columns of each table, in order, by `schema.table`.
   * @throws Error when the database cannot be reached.
   */
  public async allColumns(): Promise<Map<string, ColumnSummary[]>> {
    const columns = new Map<string, ColumnSummary[]>();
    for (const row of await this.read(ALL_COLUMNS_QUERY, [])) {
      const table = `${String(row["schema"])}.${String(row["table"])}`;
      columns.set(table, [...(columns.get(table) ?? []), { name: String(row["name"]), type: String(row["type"]), nullable: row["nullable"] === true }]);
    }
    return columns;
  }

  /**
   * Reads the primary and foreign keys of every table.
   *
   * @returns The keys of each table that has some, by `schema.table`.
   * @throws Error when the database cannot be reached.
   */
  public async keys(): Promise<Map<string, TableKeys>> {
    const keys = new Map<string, { table: string; primaryKey: string[]; foreignKeys: ForeignKey[] }>();
    for (const row of await this.read(KEYS_QUERY, [])) {
      const table = `${String(row["schema"])}.${String(row["table"])}`;
      const entry = keys.get(table) ?? { table, primaryKey: [], foreignKeys: [] };
      keys.set(table, entry);
      const columns = (row["columns"] as string[]).map(String);
      if (row["kind"] === "p") entry.primaryKey = columns;
      else
        entry.foreignKeys.push({
          columns,
          references: `${String(row["referenced_schema"])}.${String(row["referenced_table"])}`,
          referencedColumns: (row["referenced_columns"] as string[]).map(String),
        });
    }
    return keys;
  }

  /**
   * @returns The views of the database, materialized or not, without the catalog's own nor those an
   * extension installed.
   * @throws Error when the database cannot be reached.
   */
  public async views(): Promise<ViewSummary[]> {
    const rows = await this.read(VIEWS_QUERY, []);
    return rows.map((row) => ({
      view: `${String(row["schema"])}.${String(row["view"])}`,
      materialized: row["materialized"] === true,
      definition: String(row["definition"]),
      columns: (row["columns"] as string[]).map(String),
      reads: (row["reads"] as string[]).map(String),
    }));
  }

  /**
   * @returns The functions and procedures of the database, without the catalog's own nor those an extension
   * installed.
   * @throws Error when the database cannot be reached.
   */
  public async routines(): Promise<RoutineSummary[]> {
    const rows = await this.read(ROUTINES_QUERY, []);
    return rows.map((row) => ({
      routine: routineName(row["schema"], row["name"], row["arguments"]),
      ...(typeof row["result"] === "string" ? { returns: row["result"] } : {}),
      definition: String(row["definition"]),
      parameters: (row["parameters"] as string[]).map(String),
    }));
  }

  /**
   * Reads the triggers of every table and view, without those the database makes for its own constraints.
   *
   * @returns The triggers of each table or view that has some, in the order of their names, by `schema.name`.
   * @throws Error when the database cannot be reached.
   */
  public async triggers(): Promise<Map<string, TriggerSummary[]>> {
    const triggers = new Map<string, TriggerSummary[]>();
    for (const row of await this.read(TRIGGERS_QUERY, [])) {
      const table = `${String(row["schema"])}.${String(row["table"])}`;
      triggers.set(table, [
        ...(triggers.get(table) ?? []),
        {
          name: String(row["name"]),
          definition: String(row["definition"]),
          routine: routineName(row["routine_schema"], row["routine_name"], row["routine_arguments"]),
        },
      ]);
    }
    return triggers;
  }

  /**
   * Reads the whole structure, each catalog query once.
   *
   * @returns The tables of the database, their columns, keys and triggers, its views and its routines.
   * @throws Error when the database cannot be reached.
   */
  public async structure(): Promise<DatabaseStructure> {
    const [tables, columns, keys, views, routines, triggers] = await Promise.all([
      this.tables(),
      this.allColumns(),
      this.keys(),
      this.views(),
      this.routines(),
      this.triggers(),
    ]);
    return { tables, columns, keys, views, routines, triggers };
  }

  /**
   * @returns Whether the role of the connection can read or write files of the server, or run its
   * programs: a superuser, or a member of a predefined role that grants it.
   * @throws Error when the database cannot be reached.
   */
  public async hasServerAccess(): Promise<boolean> {
    const rows = await this.read(SERVER_ACCESS_QUERY, []);
    return rows[0]?.["server_access"] === true;
  }

  private async read(text: string, values: readonly unknown[]): Promise<readonly Record<string, unknown>[]> {
    assertCatalogQuery(text);
    return (await this.client.query(text, values)).rows;
  }
}

/** A routine as `schema.name(arguments)`, from the columns of a catalog row. */
function routineName(schema: unknown, name: unknown, identityArguments: unknown): string {
  return `${String(schema)}.${String(name)}(${String(identityArguments)})`;
}
