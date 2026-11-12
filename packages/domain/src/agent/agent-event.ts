import type { AgentRuntimeError } from "./errors/agent-runtime-error.ts";

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
   * (`invalid-arguments`), or the tool failed (`failed`). The model is told and may try again.
   */
  | {
      readonly type: "tool-error";
      readonly callId: string;
      readonly tool: string;
      readonly reason: "unknown-tool" | "invalid-arguments" | "failed";
      readonly message: string;
    }
  /** The agent has finished answering the message. */
  | { readonly type: "end" }
  /** The session could not go on; no event follows. */
  | { readonly type: "error"; readonly error: AgentRuntimeError };
