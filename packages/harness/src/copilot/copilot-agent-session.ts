import type { CopilotSession, SessionEvent } from "@github/copilot-sdk";
import { SessionClosedError, type AgentEvent, type AgentRuntimeError, type AgentSession } from "@open-qa-stack/domain";
import type { TaskBudget } from "../guardrails/task-budget.ts";
import type { ModelChannel } from "../model-gateway/model-channel.ts";
import type { EventRelay } from "./event-relay.ts";
import type { RefusedCall } from "./pre-tool-use.ts";
import { runtimeError } from "./runtime-error.ts";

/** What a session is wired to besides its SDK session. */
export interface SessionWiring {
  /** The gateway channel of the session: where its model requests go, and why the latest one failed. */
  readonly channel: ModelChannel;
  /** Names of the tools the session offers. */
  readonly toolNames: ReadonlySet<string>;
  /** Budget of the task, if it has limits. */
  readonly budget: TaskBudget | undefined;
  /** Calls the pre-tool hook refused, by call identifier. */
  readonly refused: ReadonlyMap<string, RefusedCall>;
}

/**
 * AgentSession over a Copilot SDK session.
 *
 * @remarks
 * Text, tool calls, end and error come from the SDK session, in the order the model listed them; tool
 * results come from the guarded tools. The SDK reports a failed model call with `session.error`, then
 * `session.idle`; the turn ends on `idle`: stopped when the budget stopped the task, with the error
 * when there was one, normally otherwise.
 */
export class CopilotAgentSession implements AgentSession {
  private readonly session: CopilotSession;
  private readonly relay: EventRelay;
  private readonly wiring: SessionWiring;
  private readonly onClose: () => void;
  private pendingError: AgentRuntimeError | undefined;

  /**
   * @param session - The SDK session.
   * @param relay - Where the session's events are delivered.
   * @param wiring - Channel, tools, budget and refused calls of the session.
   * @param onClose - Called when the session is closed.
   */
  public constructor(session: CopilotSession, relay: EventRelay, wiring: SessionWiring, onClose: () => void) {
    this.session = session;
    this.relay = relay;
    this.wiring = wiring;
    this.onClose = onClose;
    session.on((event: SessionEvent) => this.forward(event));
  }

  /** {@inheritDoc @open-qa-stack/domain#AgentSession.send} */
  public async *send(message: string): AsyncIterable<AgentEvent> {
    const turn = this.relay.startTurn();
    this.pendingError = undefined;
    await this.session.send({ prompt: message });
    yield* turn;
  }

  /** {@inheritDoc @open-qa-stack/domain#AgentSession.close} */
  public async close(): Promise<void> {
    this.relay.finish({ type: "error", error: new SessionClosedError() });
    this.onClose();
    await this.session.disconnect();
  }

  private forward(event: SessionEvent): void {
    switch (event.type) {
      case "assistant.message":
        if (event.data.content.trim() !== "") this.relay.push({ type: "text", text: event.data.content });
        return;
      case "tool.execution_start":
        return this.reportCall(event.data.toolCallId, event.data.toolName, event.data.arguments);
      case "tool.execution_complete":
        return this.reportRefusal(event.data.toolCallId);
      case "session.error":
        this.pendingError = runtimeError(this.wiring.channel.lastFailure);
        return;
      case "session.idle":
        return this.finishTurn();
      default:
        return;
    }
  }

  private reportCall(callId: string, tool: string, args: unknown): void {
    this.relay.push({ type: "tool-call", callId, tool, arguments: args });
    if (!this.wiring.toolNames.has(tool)) {
      this.relay.push({ type: "tool-error", callId, tool, reason: "unknown-tool", message: `The session offers no tool named ${tool}.` });
    }
  }

  /**
   * Reports a completed call the pre-tool hook refused; other completed calls report themselves, and a
   * call to an unknown tool is already reported as such.
   */
  private reportRefusal(callId: string): void {
    const refused = this.wiring.refused.get(callId);
    if (refused === undefined || !this.wiring.toolNames.has(refused.tool)) return;
    const message = `The task reached its ${refused.limit} limit; the call did not run.`;
    this.relay.push({ type: "tool-error", callId, tool: refused.tool, reason: "limit-reached", message });
  }

  private finishTurn(): void {
    const budget = this.wiring.budget;
    const stop = budget?.stopReason;
    if (stop !== undefined) return this.relay.finish({ type: "stopped", reason: stop });
    const counters = budget === undefined ? {} : { counters: budget.counters };
    this.relay.finish(this.pendingError === undefined ? { type: "end", ...counters } : { type: "error", error: this.pendingError, ...counters });
  }
}
