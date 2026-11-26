import type { AgentKey, JsonSchema, TerminalEvent, ToolDefinition } from "@open-qa-stack/domain";
import type { AgentTask } from "./agent-task.ts";

/** Runs the session of one review, and gives how it ended. */
export type ReviewSession = (task: Pick<AgentTask, "agent" | "instructions" | "values" | "tools" | "request" | "reminder">) => Promise<TerminalEvent>;

/** What a review asks of its agent: its instructions, its request, and the one tool it reports with. */
export interface FindingsReport<T> {
  /** The agent that reviews. */
  readonly agent: AgentKey;
  readonly instructions: string;
  /** What each variable of the prompt of the agent stands for. */
  readonly values: Readonly<Record<string, string>>;
  readonly request: string;
  /** Name of the tool the agent reports its findings with. */
  readonly tool: string;
  /** Description of the tool, written for the model. */
  readonly description: string;
  /** The shape of one finding, given to the model. */
  readonly finding: JsonSchema;
  /** The tools the agent may read with before it reports; none by default. */
  readonly tools?: readonly ToolDefinition[];
  /** When the list is empty, in the words of the reminder: `when the test is coherent with its scenario`. */
  readonly whenEmpty: string;
  /** The findings a call reports, those it gives wrongly left out. */
  parse(entries: readonly unknown[]): T[];
}

/**
 * Runs the session of a review whose agent reports a list of findings with one tool, and gives the list.
 *
 * @param run - Runs the session, under the limits and with the trace of its caller.
 * @param report - What the review asks of its agent.
 * @returns The findings reported; none for an empty list, and for a call that gives no list.
 * @throws Error when the session fails, reaches a limit or ends without a report.
 */
export async function reportedFindings<T>(run: ReviewSession, report: FindingsReport<T>): Promise<T[]> {
  let reported: T[] | undefined;
  const tool: ToolDefinition = {
    name: report.tool,
    description: report.description,
    parameters: { type: "object", properties: { findings: { type: "array", items: report.finding } }, required: ["findings"] },
    execute: async (args) => {
      const given = (args as { findings?: unknown } | null)?.findings;
      reported = report.parse(Array.isArray(given) ? (given as readonly unknown[]) : []);
      return "Recorded. Answer with one word; call no more tools.";
    },
  };
  const reminder = () => (reported === undefined ? `Call ${report.tool} now, with an empty list ${report.whenEmpty}.` : undefined);
  const last = await run({
    agent: report.agent,
    instructions: report.instructions,
    values: report.values,
    tools: [...(report.tools ?? []), tool],
    request: report.request,
    reminder,
  });
  if (reported !== undefined) return reported;
  if (last.type === "error") throw new Error(last.error.message);
  throw new Error(last.type === "stopped" ? `the review reached its ${last.reason.limit} limit.` : "the review ended without a report.");
}

/**
 * A text of a finding, on one line and cut.
 *
 * @param text - The text, as the agent gave it.
 * @param most - Most characters kept.
 * @returns The line.
 */
export function findingLine(text: string, most: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, most);
}
