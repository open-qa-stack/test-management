import type { AgentKey } from "./agent-key.ts";
import type { AgentSession } from "./agent-session.ts";
import type { TaskLimits } from "./task-limits.ts";
import type { ToolDefinition } from "./tool-definition.ts";

/** What a session starts with. */
export interface SessionOptions {
  /** The agent the session is of, which the team may give instructions to; left out for none of those. */
  readonly agent?: AgentKey;
  /** System instructions for the agent, replacing any default. */
  readonly instructions: string;
  /** The only tools the agent may call. */
  readonly tools: readonly ToolDefinition[];
  /** Limits of the task the session carries out; unbounded when absent. */
  readonly limits?: TaskLimits;
}

/**
 * What the harness needs from a model: sessions in which an agent answers messages and calls tools.
 * Implementations live outside the domain.
 */
export interface AgentRuntime {
  /**
   * Starts a session.
   *
   * @param options - Instructions and tools of the session.
   * @returns The open session.
   */
  openSession(options: SessionOptions): Promise<AgentSession>;
  /** Releases what the runtime holds, closing the sessions still open. */
  close(): Promise<void>;
}
