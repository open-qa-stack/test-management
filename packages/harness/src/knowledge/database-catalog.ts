import { assertCatalogQuery, COLUMNS_QUERY, TABLES_QUERY } from "./catalog-query.ts";
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

/** Reads the structure of a database, never its rows. */
export class DatabaseCatalog {
  private readonly client: SqlClient;

  /** @param client - Where the queries run. */
  public constructor(client: SqlClient) {
    this.client = client;
  }

  /**
   * @returns The tables of the database, without the catalog's own.
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

  private read(text: string, values: readonly unknown[]): Promise<readonly Record<string, unknown>[]> {
    assertCatalogQuery(text);
    return this.client.query(text, values);
  }
}
