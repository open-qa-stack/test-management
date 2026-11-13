import type { ColumnSummary, DatabaseCatalog } from "./database-catalog.ts";
import { dataRows, type DataRows } from "./data-rows.ts";
import { scopedToolName } from "../common/tool-name.ts";
import { readSubquery } from "./read-query.ts";
import type { SqlClient } from "./sql-client.ts";
import { shortTextColumns, sqlIdentifier } from "./sql-text.ts";

/** Why a data read was not run, in words the agent can act on. */
export interface DataRefusal {
  /** What was refused, and how to get an answer. */
  readonly error: string;
}

const TEXT_TYPES = new Set(["text", "character varying", "character", "uuid"]);
/** The SQLSTATE codes of a query that names a column, or a table, the database does not have. */
const UNKNOWN_NAMES = new Set(["42703", "42P01"]);

/**
 * Reads the data of a database: samples, searches and free read queries, always bounded.
 *
 * @remarks
 * Every read runs through the client's read-only transaction and fetches each value as short text, so
 * that neither the number of rows nor the size of a value can exhaust the harness. A sample or a search
 * gives the columns of the primary key first, then the others in the order of the table. Samples and searches
 * only touch a table the catalog knows, with quoted identifiers and the searched value as a parameter.
 * A free query first runs with no rows to learn its columns; it is refused when the connection's role can
 * reach the database server, or when two of its columns share a name, since one would hide the other.
 */
export class DatabaseData {
  private readonly knowledgeId: string;
  private readonly client: SqlClient;
  private readonly catalog: DatabaseCatalog;

  /**
   * @param knowledgeId - Identifier of the knowledge source, to name it in refusals.
   * @param client - Where the reads run.
   * @param catalog - What tables and columns exist.
   */
  public constructor(knowledgeId: string, client: SqlClient, catalog: DatabaseCatalog) {
    this.knowledgeId = knowledgeId;
    this.client = client;
    this.catalog = catalog;
  }

  /**
   * @param schema - Schema of the table.
   * @param table - Name of the table.
   * @param limit - Rows to return, already bounded.
   * @returns The first rows of the table, the columns of its primary key first, or why there are none.
   * @throws Error when the database cannot be reached.
   */
  public async sample(schema: string, table: string, limit: number): Promise<DataRows | DataRefusal> {
    const columns = await this.columnsOf(schema, table);
    if (columns.length === 0) return this.noTable(schema, table);
    return this.read(
      columns.map((c) => c.name),
      `${qualified(schema, table)} LIMIT ${limit + 1}`,
      [],
      limit,
    );
  }

  /**
   * @param schema - Schema of the table.
   * @param table - Name of the table.
   * @param value - Text to find, in any case, anywhere in a text column.
   * @param limit - Rows to return, already bounded.
   * @returns The rows where a text column contains `value`, the columns of its primary key first, or why there are none.
   * @throws Error when the database cannot be reached.
   */
  public async search(schema: string, table: string, value: string, limit: number): Promise<DataRows | DataRefusal> {
    const columns = await this.columnsOf(schema, table);
    if (columns.length === 0) return this.noTable(schema, table);
    const searched = columns.filter((c) => TEXT_TYPES.has(c.type));
    if (searched.length === 0) return { error: `The table ${schema}.${table} has no text column to search.` };
    const where = searched.map((c) => `${sqlIdentifier(c.name)}::text ILIKE $1 ESCAPE '\\'`).join(" OR ");
    const pattern = `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return this.read(
      columns.map((c) => c.name),
      `${qualified(schema, table)} WHERE ${where} LIMIT ${limit + 1}`,
      [pattern],
      limit,
    );
  }

  /**
   * @param sql - A single `SELECT` or `WITH` query.
   * @param limit - Rows to return, already bounded.
   * @returns Its rows, or why it was not run.
   * @throws Error when the database cannot be reached or rejects the query; for a column or a table it does
   * not have, the error ends with the tool that lists the columns of a table.
   */
  public async query(sql: string, limit: number): Promise<DataRows | DataRefusal> {
    let subquery: string;
    try {
      subquery = readSubquery(sql);
    } catch (refusal) {
      return { error: (refusal as Error).message };
    }
    if (await this.catalog.hasServerAccess()) {
      return {
        error:
          "Free queries are refused: the role of the database connection can reach the server's files or programs. Declare a connection with a role that is neither a superuser nor a member of pg_read_server_files, pg_write_server_files or pg_execute_server_program.",
      };
    }
    return this.named(async () => {
      const { columns } = await this.client.query(`SELECT * FROM ${subquery} LIMIT 0`, []);
      const repeated = columns.find((name, index) => columns.indexOf(name) !== index);
      if (repeated !== undefined) return { error: `The query returns more than one column named ${repeated}. Give each column its own name.` };
      return this.read(columns, `${subquery} LIMIT ${limit + 1}`, [], limit);
    });
  }

  /** Runs a free query, its error ending with the tool that gives the exact names when it names a column or a table the database does not have. */
  private async named<T>(query: () => Promise<T>): Promise<T> {
    try {
      return await query();
    } catch (failure) {
      const { message, cause } = failure as Error;
      if (!UNKNOWN_NAMES.has((cause as { code?: string } | undefined)?.code ?? "")) throw failure;
      throw new Error(`${message} Call ${scopedToolName(this.knowledgeId, "describe_table")} for the exact names.`, { cause });
    }
  }

  /** The columns of a table the catalog knows, those of its primary key first; none for another table. */
  private async columnsOf(schema: string, table: string): Promise<ColumnSummary[]> {
    const known = (await this.catalog.tables()).some((t) => t.schema === schema && t.table === table);
    if (!known) return [];
    const [columns, keys] = await Promise.all([this.catalog.columns(schema, table), this.catalog.keys()]);
    const primaryKey = keys.get(`${schema}.${table}`)?.primaryKey ?? [];
    return [
      ...primaryKey.flatMap((name) => columns.filter((column) => column.name === name)),
      ...columns.filter((column) => !primaryKey.includes(column.name)),
    ];
  }

  private noTable(schema: string, table: string): DataRefusal {
    return { error: `The database ${this.knowledgeId} has no table ${schema}.${table}.` };
  }

  private async read(columns: readonly string[], from: string, values: readonly unknown[], limit: number): Promise<DataRows> {
    return dataRows(await this.client.query(`SELECT ${shortTextColumns(columns)} FROM ${from}`, values), limit);
  }
}

function qualified(schema: string, table: string): string {
  return `${sqlIdentifier(schema)}.${sqlIdentifier(table)}`;
}
