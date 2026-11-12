import type { AgentEvent } from "@open-qa-stack/domain";
import { CopilotAgentRuntime } from "./copilot/copilot-agent-runtime.ts";
import { ModelGateway } from "./model-gateway/model-gateway.ts";
import type { Recording } from "./model-gateway/recording.ts";
import type { Upstream } from "./model-gateway/upstream.ts";
import { TOOL_CALLING_CHECK, type ToolCallingVerdict } from "./tool-calling-check.ts";

/** What a recording of the tool-calling check needs. */
export interface CheckRecordingOptions {
  /** The model server to check. */
  readonly upstream: Upstream;
  /** Model identifier, as the model server names it. */
  readonly model: string;
  /** Name and version of the model server, written in the recording's origin. */
  readonly server: string;
  /** Date of the recording, `YYYY-MM-DD`. */
  readonly recordedOn: string;
  /** Directory where the Copilot runtime keeps its state during the check. */
  readonly homeDirectory: string;
}

/** The outcome of a recorded check. */
export interface CheckRecording {
  readonly recording: Recording;
  readonly events: readonly AgentEvent[];
  readonly verdict: ToolCallingVerdict;
}

/**
 * Runs the tool-calling check against a real model server and records it.
 *
 * @param options - The server, the model and where the runtime keeps its state.
 * @returns The recording, the events of the session and the verdict.
 */
export async function recordToolCallingCheck(options: CheckRecordingOptions): Promise<CheckRecording> {
  const gateway = await ModelGateway.start({
    kind: "record",
    upstream: options.upstream,
    origin: { kind: "recorded", model: options.model, server: options.server, recordedOn: options.recordedOn },
  });
  const runtime = new CopilotAgentRuntime({ endpoint: gateway, model: options.model, homeDirectory: options.homeDirectory });
  const events: AgentEvent[] = [];
  try {
    const session = await runtime.openSession(TOOL_CALLING_CHECK.session());
    for await (const event of session.send(TOOL_CALLING_CHECK.message)) events.push(event);
    await session.close();
    return { recording: gateway.recording, events, verdict: TOOL_CALLING_CHECK.evaluate(events) };
  } finally {
    await runtime.close();
    await gateway.close();
  }
}
