import type { AgentRuntimeError } from "./errors/agent-runtime-error.ts";
import type { StopReason } from "./task-limits.ts";

/** Something that happened in a session, in the order it happened. */
export type AgentEvent =
  /** Text the model produced. */
  | { readonly type: "text"; readonly text: string }
  /** The model called a tool. */
  | { readonly type: "tool-call"; readonly callId: string; readonly tool: string; readonly arguments: unknown }
  /** A tool ran and returned `result`. */
  | { readonly type: "tool-result"; readonly callId: string; readonly tool: string; readonly result: unknown }
  /**
   * A tool call produced no result: the model called a tool the session does not offer
   * (`unknown-tool`), the arguments did not match the schema so the tool did not run
   * (`invalid-arguments`), a limit of the task refused the call (`limit-reached`), or the tool
   * failed (`failed`). The model is told.
   */
  | {
      readonly type: "tool-error";
      readonly callId: string;
      readonly tool: string;
      readonly reason: "unknown-tool" | "invalid-arguments" | "limit-reached" | "failed";
      readonly message: string;
    }
  /** The agent has finished answering the message. */
  | { readonly type: "end" }
  /** The harness stopped the task because it reached a limit; no event follows. */
  | { readonly type: "stopped"; readonly reason: StopReason }
  /** The session could not go on; no event follows. */
  | { readonly type: "error"; readonly error: AgentRuntimeError };

/** The event that ends a turn. */
export type TerminalEvent = Extract<AgentEvent, { type: "end" | "stopped" | "error" }>;
