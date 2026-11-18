import type { AgentRuntime } from "@open-qa-stack/domain";

/** A runtime of the agents, and how to release it. */
export interface OpenRuntime {
  readonly runtime: AgentRuntime;
  /** Stops the runtime and what it was opened with. */
  close(): Promise<void>;
}
