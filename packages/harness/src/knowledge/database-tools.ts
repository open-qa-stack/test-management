import type { ToolDefinition } from "@open-qa-stack/domain";
import type { DatabaseCatalog } from "./database-catalog.ts";
import type { DatabaseData } from "./database-data.ts";
import { MAX_ROWS, rowLimit } from "./read-query.ts";
import { scopedToolName } from "../tools/tool-name.ts";

const limit = { type: "integer", minimum: 1, maximum: MAX_ROWS, description: `Rows to return, ${MAX_ROWS} at most.` } as const;
const tableArgs = { schema: { type: "string" }, table: { type: "string" } } as const;

/**
 * The tools of a PostgreSQL knowledge source: list its tables, describe one, sample its rows, search a
 * value, run a read query. Every read is read-only and bounded in rows; data values come back as text,
 * cut when long.
 *
 * @param knowledgeId - Identifier of the knowledge source.
 * @param catalog - Its catalog.
 * @param data - Its data.
 * @returns The five tools.
 */
export function databaseTools(knowledgeId: string, catalog: DatabaseCatalog, data: DatabaseData): ToolDefinition[] {
  return [
    {
      name: scopedToolName(knowledgeId, "list_tables"),
      description: `Lists the tables of the database ${knowledgeId}, by schema. Reads the catalog only.`,
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: () => catalog.tables(),
    },
    {
      name: scopedToolName(knowledgeId, "describe_table"),
      description: `Lists the columns of a table of the database ${knowledgeId}: name, type, nullable. Reads the catalog only.`,
      parameters: {
        type: "object",
        properties: { schema: { type: "string" }, table: { type: "string" } },
        required: ["schema", "table"],
        additionalProperties: false,
      },
      execute: async (args) => {
        const { schema, table } = args as { schema: string; table: string };
        const columns = await catalog.columns(schema, table);
        return columns.length > 0 ? columns : { error: `The database ${knowledgeId} has no table ${schema}.${table}.` };
      },
    },
    {
      name: scopedToolName(knowledgeId, "sample_rows"),
      description: `Returns the first rows of a table of the database ${knowledgeId}. Read-only.`,
      parameters: { type: "object", properties: { ...tableArgs, limit }, required: ["schema", "table"], additionalProperties: false },
      execute: (args) => {
        const { schema, table, limit: requested } = args as { schema: string; table: string; limit?: number };
        return data.sample(schema, table, rowLimit(requested));
      },
    },
    {
      name: scopedToolName(knowledgeId, "search"),
      description: `Returns the rows of a table of the database ${knowledgeId} where a text column contains a value, in any case. Read-only.`,
      parameters: {
        type: "object",
        properties: { ...tableArgs, value: { type: "string", minLength: 1 }, limit },
        required: ["schema", "table", "value"],
        additionalProperties: false,
      },
      execute: (args) => {
        const { schema, table, value, limit: requested } = args as { schema: string; table: string; value: string; limit?: number };
        return data.search(schema, table, value, rowLimit(requested));
      },
    },
    {
      name: scopedToolName(knowledgeId, "query"),
      description: `Runs one read-only SELECT or WITH query on the database ${knowledgeId}, without semicolons, and returns its rows, each value as text. Give each column its own name.`,
      parameters: { type: "object", properties: { sql: { type: "string", minLength: 1 }, limit }, required: ["sql"], additionalProperties: false },
      execute: (args) => {
        const { sql, limit: requested } = args as { sql: string; limit?: number };
        return data.query(sql, rowLimit(requested));
      },
    },
  ];
}
