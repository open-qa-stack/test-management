import type { AgentEvent, AgentRuntime, TaskCounters, TaskLimits, TerminalEvent, ToolDefinition } from "@open-qa-stack/domain";
import type { ResolvedConfig } from "@open-qa-stack/shared";

/** Times an agent is reminded to hand its result in when it stops without an accepted one. */
export const MAX_REMINDERS = 3;

/** One task of an agent, run in its own session. */
export interface AgentTask {
  /** System instructions of the role. */
  readonly instructions: string;
  /** The tools of the task. */
  readonly tools: readonly ToolDefinition[];
  /** The first message. */
  readonly request: string;
  /** Receives each event as it comes, so that the tools see what happened so far. */
  readonly events: AgentEvent[];
  /** The next message after a turn that ended normally, if any. */
  readonly reminder: () => string | undefined;
  /** Receives each message sent to the agent, before it is sent. */
  readonly sent?: (message: string) => void;
  /** Receives each event as it comes, after it was added to `events`. */
  readonly received?: (event: AgentEvent) => void;
}

/**
 * The task limits of the configured autonomy.
 *
 * @param config - The resolved configuration.
 * @returns The limits, a duration in minutes turned into milliseconds.
 */
export function taskLimits(config: ResolvedConfig): TaskLimits {
  const { task } = config.autonomy.limits;
  return { maxIterations: task.maxIterations, maxDurationMs: task.maxDurationMinutes === null ? null : task.maxDurationMinutes * 60_000, maxActions: task.maxActions };
}

/**
 * Runs a task in a session under the given limits, reminding the agent up to `MAX_REMINDERS` times when it
 * stops without its result.
 *
 * @param runtime - The runtime that opens the session.
 * @param task - The task.
 * @param limits - Its limits.
 * @throws Error when the session cannot be opened.
 */
export async function runAgentTask(runtime: AgentRuntime, task: AgentTask, limits: TaskLimits): Promise<void> {
  const session = await runtime.openSession({ instructions: task.instructions, tools: task.tools, limits });
  try {
    let message: string | undefined = task.request;
    for (let turn = 0; message !== undefined; turn++) {
      task.sent?.(message);
      for await (const event of session.send(message)) {
        task.events.push(event);
        task.received?.(event);
      }
      message = turn < MAX_REMINDERS && task.events.at(-1)!.type === "end" ? task.reminder() : undefined;
    }
  } finally {
    await session.close();
  }
}

/**
 * The event that ended a task, and what the task used.
 *
 * @param events - The events of a task run with limits.
 * @returns Its last event and its counters.
 */
export function taskEnd(events: readonly AgentEvent[]): { readonly last: TerminalEvent; readonly counters: TaskCounters } {
  // A session always ends a turn with a terminal event, and one with limits gives its counters.
  const last = events.at(-1) as TerminalEvent;
  return { last, counters: last.type === "stopped" ? last.reason.counters : last.counters! };
}
