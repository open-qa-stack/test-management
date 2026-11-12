import { Ajv2020 } from "ajv/dist/2020.js";
import type { AgentEvent, ToolDefinition } from "@open-qa-stack/domain";

/** What a guarded tool sends back to the model: the tool's result, or why there is none. */
export type ToolReply = { readonly result: unknown } | { readonly error: string };

/** Runs one call of a tool, identified by `callId`. */
export type GuardedTool = (args: unknown, callId: string) => Promise<ToolReply>;

type ToolErrorReason = Extract<AgentEvent, { type: "tool-error" }>["reason"];

/**
 * Wraps a tool so that its arguments are checked against its schema before it runs.
 *
 * @param tool - The tool to guard.
 * @param emit - Receives a `tool-result` or a `tool-error` event for every call.
 * @returns A function that runs one call; arguments that do not match the schema never reach `execute`.
 */
export function guardTool(tool: ToolDefinition, emit: (event: AgentEvent) => void): GuardedTool {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const matchesSchema = ajv.compile(tool.parameters);
  const error = (callId: string, reason: ToolErrorReason, message: string): ToolReply => {
    emit({ type: "tool-error", callId, tool: tool.name, reason, message });
    return { error: message };
  };

  return async (args, callId) => {
    if (!matchesSchema(args)) {
      const details = ajv.errorsText(matchesSchema.errors, { dataVar: "arguments" });
      return error(callId, "invalid-arguments", `The arguments do not match the schema of ${tool.name}: ${details}.`);
    }
    try {
      const result = await tool.execute(args);
      emit({ type: "tool-result", callId, tool: tool.name, result });
      return { result };
    } catch (failure) {
      return error(callId, "failed", failure instanceof Error ? failure.message : String(failure));
    }
  };
}
