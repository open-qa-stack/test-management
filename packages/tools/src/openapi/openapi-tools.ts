import type { ToolDefinition } from "@open-qa-stack/domain";
import { HTTP_METHODS, type OpenApiContract } from "./openapi-contract.ts";
import { scopedToolName } from "../common/tool-name.ts";

/**
 * The tools of an OpenAPI knowledge source: list its operations, read one.
 *
 * @param knowledgeId - Identifier of the knowledge source.
 * @param contract - Its contract.
 * @returns The two tools.
 */
export function openApiTools(knowledgeId: string, contract: OpenApiContract): ToolDefinition[] {
  return [
    {
      name: scopedToolName(knowledgeId, "list_operations"),
      description: `Lists the operations of the API contract ${knowledgeId}: method, path, identifier and summary.`,
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: () => contract.operations(),
    },
    {
      name: scopedToolName(knowledgeId, "read_operation"),
      description: `Returns one operation of the API contract ${knowledgeId}: parameters, request body and responses, with their schemas.`,
      parameters: {
        type: "object",
        properties: { method: { type: "string", enum: HTTP_METHODS.map((m) => m.toUpperCase()) }, path: { type: "string" } },
        required: ["method", "path"],
        additionalProperties: false,
      },
      execute: async (args) => {
        const { method, path } = args as { method: string; path: string };
        return (await contract.operation(method, path)) ?? { error: `The contract has no operation ${method.toUpperCase()} ${path}.` };
      },
    },
  ];
}
