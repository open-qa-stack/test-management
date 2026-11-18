import type { AgentEvent, AgentRuntime, TaskLimits } from "@open-qa-stack/domain";
import { runAgentTask, type AgentTask } from "../common/agent-task.ts";
import type { Journal } from "../common/journal.ts";
import { sessionUse, type SessionsUse } from "./group-elements.ts";

/** The session of an agent that maps a source, and how its journal names it. */
export interface MapSession {
  readonly runtime: AgentRuntime;
  /** The task of the agent, but its events, which the session gathers. */
  readonly task: Omit<AgentTask, "events">;
  readonly limits: TaskLimits;
  readonly journal: Journal;
  /** The source the agent maps. */
  readonly sourceId: string;
  /** What the session does to the source, as the journal tells it, such as `explores`. */
  readonly doing: string;
}

/**
 * Runs the session of an agent that maps a source, and journals the limit or the failure it ended on.
 *
 * @param session - The session, its task and how its journal names it.
 * @returns What the session used.
 */
export async function runMapSession(session: MapSession): Promise<SessionsUse> {
  const { journal, sourceId, doing } = session;
  const events: AgentEvent[] = [];
  await runAgentTask(session.runtime, { ...session.task, events }, session.limits);
  const last = events.at(-1)!;
  if (last.type === "stopped") journal.record("error", `The session that ${doing} ${sourceId} reached its ${last.reason.limit} limit.`, sourceId);
  if (last.type === "error") journal.record("error", `The session that ${doing} ${sourceId} failed: ${last.error.message}`, sourceId);
  return sessionUse(events);
}
