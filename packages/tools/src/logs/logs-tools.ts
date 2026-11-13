import type { ToolDefinition } from "@open-qa-stack/domain";
import { redactText, secretForms } from "../browser/redact.ts";
import { scopedToolName } from "../common/tool-name.ts";
import { parseInstant } from "./log-instant.ts";
import { readLog, type LogReading } from "./log-reading.ts";
import type { LogSource } from "./log-source.ts";

/** Most lines one reading returns. */
export const MAX_LOG_LINES = 500;
/** Lines a reading returns when the agent asks for no number. */
export const DEFAULT_LOG_LINES = 100;

/**
 * The tool of a log knowledge source: read the lines a service wrote from an instant.
 *
 * @remarks
 * The tool only reads the one log the configuration declares. The agent gives an instant, a filter and a
 * number of lines; none of them reaches a command as text.
 *
 * @param knowledgeId - Identifier of the knowledge source.
 * @param source - The log.
 * @param taskStart - The instant read from when the agent gives none: the start of the task.
 * @param secrets - Values no line may show.
 * @returns The tool.
 */
export function logsTools(knowledgeId: string, source: LogSource, taskStart: Date, secrets: readonly string[]): ToolDefinition[] {
  const forms = secrets.flatMap(secretForms);
  return [
    {
      name: scopedToolName(knowledgeId, "read_logs"),
      description: `Returns the lines the service of ${knowledgeId} logged from an instant, in order, those that contain a text if one is given. Read it after an action to see what the service did: an error, a message, a rule applied.`,
      parameters: {
        type: "object",
        properties: {
          since: { type: "string", minLength: 1, description: "Date and time to read from, ISO 8601, such as 2026-11-13T10:15:00Z; local time without an offset. The start of the task when absent." },
          filter: { type: "string", minLength: 1, maxLength: 200, description: "Keeps the lines that contain this text, ignoring case." },
          limit: { type: "integer", minimum: 1, maximum: MAX_LOG_LINES, description: `Most lines to return; ${DEFAULT_LOG_LINES} by default.` },
        },
        additionalProperties: false,
      },
      execute: async (args): Promise<LogReading> => {
        const { since, filter, limit = DEFAULT_LOG_LINES } = args as { since?: string; filter?: string; limit?: number };
        const instant = since === undefined ? taskStart.getTime() : parseInstant(since);
        const log = await source.lines(instant).catch((failure: Error) => {
          throw new Error(redactText(failure.message, forms));
        });
        return readLog(log, { since: instant, ...(filter === undefined ? {} : { filter }), limit, secrets: forms });
      },
    },
  ];
}
