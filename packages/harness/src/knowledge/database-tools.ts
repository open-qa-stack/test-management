import type { ToolDefinition } from "@open-qa-stack/domain";
import type { DatabaseCatalog } from "./database-catalog.ts";
import { knowledgeToolName } from "./tool-name.ts";

/**
 * The tools of a PostgreSQL knowledge source: list its tables, describe one. Neither reads a row.
 *
 * @param knowledgeId - Identifier of the knowledge source.
 * @param catalog - Its catalog.
 * @returns The two tools.
 */
export function databaseTools(knowledgeId: string, catalog: DatabaseCatalog): ToolDefinition[] {
  return [
    {
      name: knowledgeToolName(knowledgeId, "list_tables"),
      description: `Lists the tables of the database ${knowledgeId}, by schema. Reads the catalog only.`,
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: () => catalog.tables(),
    },
    {
      name: knowledgeToolName(knowledgeId, "describe_table"),
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
  ];
}
