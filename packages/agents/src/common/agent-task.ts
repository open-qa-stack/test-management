import type { AgentEvent, AgentRuntime, TaskCounters, TaskLimits, TerminalEvent, ToolDefinition } from "@open-qa-stack/domain";
import type { ResolvedConfig } from "@open-qa-stack/shared";
import type { PersonDelivery } from "./person-delivery.ts";
import { PERSON_RULE } from "./person-message.ts";

/** Times an agent is reminded to hand its result in when it stops without an accepted one. */
export const MAX_REMINDERS = 3;

/**
 * Turns a session is given for the messages of the person alone, at most: a person who keeps writing cannot
 * keep a session open for ever. A message beyond them still goes with the result of a tool, or to the next
 * session.
 */
export const MAX_PERSON_TURNS = 10;

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
  /** Gives the task the messages the person sends while it runs; a task without it receives none. */
  readonly person?: PersonDelivery;
}

/**
 * The task limits of the configured autonomy.
 *
 * @param config - The resolved configuration.
 * @returns The limits, a duration in minutes turned into milliseconds.
 */
export function taskLimits(config: ResolvedConfig): TaskLimits {
  const { task } = config.autonomy.limits;
  return {
    maxIterations: task.maxIterations,
    maxDurationMs: task.maxMinutes === null ? null : task.maxMinutes * 60_000,
    maxActions: task.maxActions,
  };
}

/**
 * Runs a task in a session under the given limits, reminding the agent up to `MAX_REMINDERS` times when it
 * stops without its result.
 *
 * @remarks
 * A task that has a delivery hears the person while it runs. Its instructions end with the rule of their
 * messages; the messages other sessions of the run received before it opened are recalled after its request,
 * since they amend it for the rest of the run; the messages pending when the session opens end its request,
 * delivered there and so recalled by no part of it; those that come while the agent
 * works go with the result of the tool that returns next; and those pending when a turn ends normally are
 * the next message, in a turn that is no reminder and counts as none, up to `MAX_PERSON_TURNS` of them. A
 * session an error or a limit stopped receives nothing more.
 *
 * @param runtime - The runtime that opens the session.
 * @param task - The task.
 * @param limits - Its limits.
 * @throws Error when the session cannot be opened.
 */
export async function runAgentTask(runtime: AgentRuntime, task: AgentTask, limits: TaskLimits): Promise<void> {
  const { person } = task;
  const session = await runtime.openSession({
    instructions: person === undefined ? task.instructions : `${task.instructions}\n\n${PERSON_RULE}`,
    tools: person === undefined ? task.tools : person.heard(task.tools),
    limits,
  });
  try {
    // What was delivered before the session opened is read first: a message delivered in this request is not recalled in it too.
    const opening = [task.request, person?.recalled(), person?.spoken()].filter((part) => part !== undefined);
    let message: string | undefined = opening.join("\n\n");
    let reminders = 0;
    let personTurns = 0;
    while (message !== undefined) {
      task.sent?.(message);
      for await (const event of session.send(message)) {
        task.events.push(event);
        task.received?.(event);
      }
      if (task.events.at(-1)!.type !== "end") break;
      const spoken = personTurns < MAX_PERSON_TURNS ? person?.spoken() : undefined;
      if (spoken === undefined) message = reminders++ < MAX_REMINDERS ? task.reminder() : undefined;
      else {
        personTurns += 1;
        message = spoken;
      }
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
