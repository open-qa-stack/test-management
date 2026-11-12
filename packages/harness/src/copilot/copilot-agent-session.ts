import type { CopilotSession, SessionEvent } from "@github/copilot-sdk";
import { SessionClosedError, type AgentEvent, type AgentRuntimeError, type AgentSession } from "@open-qa-stack/domain";
import type { ModelEndpoint } from "../model-gateway/model-endpoint.ts";
import type { EventRelay } from "./event-relay.ts";
import { runtimeError } from "./runtime-error.ts";

/**
 * AgentSession over a Copilot SDK session.
 *
 * @remarks
 * Text, tool calls, end and error come from the SDK session, in the order the model listed them; tool
 * results come from the guarded tools. The SDK reports a failed model call with `session.error`, then
 * `session.idle`; the turn ends on `idle`, with the error when there was one.
 */
export class CopilotAgentSession implements AgentSession {
  private readonly session: CopilotSession;
  private readonly relay: EventRelay;
  private readonly onClose: () => void;
  private pendingError: AgentRuntimeError | undefined;

  /**
   * @param session - The SDK session.
   * @param relay - Where the session's events are delivered.
   * @param endpoint - What the gateway saw when a model call failed.
   * @param toolNames - Names of the tools the session offers.
   * @param onClose - Called when the session is closed.
   */
  public constructor(session: CopilotSession, relay: EventRelay, endpoint: ModelEndpoint, toolNames: ReadonlySet<string>, onClose: () => void) {
    this.session = session;
    this.relay = relay;
    this.onClose = onClose;
    session.on((event: SessionEvent) => this.forward(event, endpoint, toolNames));
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

  private forward(event: SessionEvent, endpoint: ModelEndpoint, toolNames: ReadonlySet<string>): void {
    switch (event.type) {
      case "assistant.message":
        if (event.data.content.trim() !== "") this.relay.push({ type: "text", text: event.data.content });
        return;
      case "tool.execution_start": {
        const { toolCallId: callId, toolName: tool, arguments: args } = event.data;
        this.relay.push({ type: "tool-call", callId, tool, arguments: args });
        if (!toolNames.has(tool)) {
          this.relay.push({ type: "tool-error", callId, tool, reason: "unknown-tool", message: `The session offers no tool named ${tool}.` });
        }
        return;
      }
      case "session.error":
        this.pendingError = runtimeError(endpoint.lastFailure);
        return;
      case "session.idle":
        this.relay.finish(this.pendingError === undefined ? { type: "end" } : { type: "error", error: this.pendingError });
        return;
      default:
        return;
    }
  }
}
