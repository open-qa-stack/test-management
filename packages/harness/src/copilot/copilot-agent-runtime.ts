import { approveAll, CopilotClient, type Tool } from "@github/copilot-sdk";
import type { AgentRuntime, AgentSession, SessionOptions, ToolDefinition } from "@open-qa-stack/domain";
import { SYSTEM_CLOCK, type Clock } from "../guardrails/clock.ts";
import { TaskBudget } from "../guardrails/task-budget.ts";
import type { ModelEndpoint } from "../model-gateway/model-endpoint.ts";
import { guardTool } from "../tools/guard-tool.ts";
import { CopilotAgentSession } from "./copilot-agent-session.ts";
import { EventRelay } from "./event-relay.ts";
import { preToolUse, type RefusedCall } from "./pre-tool-use.ts";
import { runtimeEnvironment } from "./runtime-environment.ts";

/** How a Copilot runtime reaches the model. */
export interface CopilotRuntimeOptions {
  /** Where each session gets its channel to the model; usually a `ModelGateway`. */
  readonly endpoint: ModelEndpoint;
  /** Model identifier, as the model server names it. */
  readonly model: string;
  /** Directory where the Copilot runtime keeps its state, apart from any user installation. */
  readonly homeDirectory: string;
  /** Where task durations are measured; the system clock when absent. */
  readonly clock?: Clock;
}

/**
 * AgentRuntime backed by the GitHub Copilot SDK, with a provider key on an OpenAI-compatible server.
 *
 * @remarks
 * Requests use the chat completions API. Sessions offer their own tools only: the built-in tools of the
 * runtime are off, and no GitHub account is used. The runtime process gets the few environment
 * variables it needs, never a key.
 *
 * Each session talks to its own gateway channel. A session with limits carries a task budget: its
 * channel counts each model call as an iteration and serves none once the task is stopped, and the SDK's pre-tool hook counts browser actions and refuses
 * calls once the task is stopped. Duration is checked at each of these checkpoints.
 */
export class CopilotAgentRuntime implements AgentRuntime {
  private readonly options: CopilotRuntimeOptions;
  private readonly client: CopilotClient;
  private readonly sessions = new Set<CopilotAgentSession>();
  private started: Promise<void> | undefined;

  /** @param options - How the runtime reaches the model. */
  public constructor(options: CopilotRuntimeOptions) {
    this.options = options;
    this.client = new CopilotClient({
      useLoggedInUser: false,
      baseDirectory: options.homeDirectory,
      logLevel: "error",
      env: runtimeEnvironment(process.env),
    });
  }

  /** {@inheritDoc @open-qa-stack/domain#AgentRuntime.openSession} */
  public async openSession(options: SessionOptions): Promise<AgentSession> {
    this.started ??= this.client.start();
    await this.started;
    const relay = new EventRelay();
    const budget = options.limits === undefined ? undefined : new TaskBudget(options.limits, this.options.clock ?? SYSTEM_CLOCK);
    const refused = new Map<string, RefusedCall>();
    const browserTools = new Set(options.tools.filter((t) => t.browserAction === true).map((t) => t.name));
    const channel = this.options.endpoint.createChannel(budget);
    const sdkSession = await this.client.createSession({
      model: this.options.model,
      provider: { type: "openai", wireApi: "completions", baseUrl: channel.baseUrl },
      onPermissionRequest: approveAll,
      availableTools: options.tools.map((t) => t.name),
      systemMessage: { mode: "replace", content: options.instructions },
      tools: options.tools.map((tool) => sdkTool(tool, relay)),
      hooks: { onPreToolUse: (input) => preToolUse(input, { budget, browserTools, refused }) },
    });
    const wiring = { channel, toolNames: new Set(options.tools.map((t) => t.name)), budget, refused };
    const session = new CopilotAgentSession(sdkSession, relay, wiring, () => this.sessions.delete(session));
    this.sessions.add(session);
    return session;
  }

  /** {@inheritDoc @open-qa-stack/domain#AgentRuntime.close} */
  public async close(): Promise<void> {
    await Promise.all([...this.sessions].map((s) => s.close()));
    if (this.started === undefined) return;
    await this.started;
    await this.client.stop();
  }
}

/** The SDK form of a tool, guarded and reporting to the session's relay. */
function sdkTool(tool: ToolDefinition, relay: EventRelay): Tool {
  const run = guardTool(tool, (event) => relay.push(event));
  return {
    name: tool.name,
    description: tool.description,
    parameters: { ...tool.parameters },
    handler: async (args, invocation) => JSON.stringify(await run(args, invocation.toolCallId)),
  };
}
