import { Ajv2020 } from "ajv/dist/2020.js";
import type { AgentEvent, ToolDefinition } from "@open-qa-stack/domain";
import { schemaProblems } from "./schema-problems.ts";
import type { SessionImages, ShownResult } from "./session-images.ts";

/** What a guarded tool sends back to the model: the tool's result, with the image it is shown besides if any, or why there is none. */
export type ToolReply = ShownResult | { readonly error: string };

/** Runs one call of a tool, identified by `callId`. */
export type GuardedTool = (args: unknown, callId: string) => Promise<ToolReply>;

type ToolErrorReason = Extract<AgentEvent, { type: "tool-error" }>["reason"];

/**
 * Wraps a tool so that its arguments are checked against its schema before it runs.
 *
 * @param tool - The tool to guard.
 * @param emit - Receives a `tool-result` or a `tool-error` event for every call.
 * @param images - Which images of the tools of the session its model is shown.
 * @returns A function that runs one call; arguments that do not match the schema never reach `execute`.
 */
export function guardTool(tool: ToolDefinition, emit: (event: AgentEvent) => void, images: SessionImages): GuardedTool {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const matchesSchema = ajv.compile(tool.parameters);
  const error = (callId: string, reason: ToolErrorReason, message: string): ToolReply => {
    emit({ type: "tool-error", callId, tool: tool.name, reason, message });
    return { error: message };
  };

  return async (args, callId) => {
    if (!matchesSchema(args)) {
      const details = schemaProblems(matchesSchema.errors!).join("; ");
      return error(callId, "invalid-arguments", `The arguments do not match the schema of ${tool.name}: ${details}.`);
    }
    try {
      const shown = images.shownResult(await tool.execute(args));
      images.record(shown);
      emit({ type: "tool-result", callId, tool: tool.name, result: shown.result });
      return shown;
    } catch (failure) {
      return error(callId, "failed", failure instanceof Error ? failure.message : String(failure));
    }
  };
}
