import type { AgentEvent } from "./agent-event.ts";

/** A conversation with an agent. */
export interface AgentSession {
  /**
   * Sends a message to the agent.
   *
   * @param message - What the user says.
   * @returns The events the message causes, ending with `end`, `stopped` or `error`.
   */
  send(message: string): AsyncIterable<AgentEvent>;
  /** Ends the session; it cannot be used afterwards. */
  close(): Promise<void>;
}
