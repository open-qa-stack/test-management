import { approveAll, CopilotClient, type Tool } from "@github/copilot-sdk";
import type { AgentRuntime, AgentSession, SessionOptions, ToolDefinition } from "@open-qa-stack/domain";
import type { ModelEndpoint } from "../model-gateway/model-endpoint.ts";
import { guardTool } from "../tools/guard-tool.ts";
import { CopilotAgentSession } from "./copilot-agent-session.ts";
import { EventRelay } from "./event-relay.ts";
import { runtimeEnvironment } from "./runtime-environment.ts";

/** How a Copilot runtime reaches the model. */
export interface CopilotRuntimeOptions {
  /** Where model requests go; usually a `ModelGateway`. */
  readonly endpoint: ModelEndpoint;
  /** Model identifier, as the model server names it. */
  readonly model: string;
  /** Directory where the Copilot runtime keeps its state, apart from any user installation. */
  readonly homeDirectory: string;
}

/**
 * AgentRuntime backed by the GitHub Copilot SDK, with a provider key on an OpenAI-compatible server.
 *
 * @remarks
 * Requests use the chat completions API. Sessions offer their own tools only: the built-in tools of the
 * runtime are off, and no GitHub account is used. The runtime process gets the few environment
 * variables it needs, never a key.
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
    const sdkSession = await this.client.createSession({
      model: this.options.model,
      provider: { type: "openai", wireApi: "completions", baseUrl: this.options.endpoint.baseUrl },
      onPermissionRequest: approveAll,
      availableTools: options.tools.map((t) => t.name),
      systemMessage: { mode: "replace", content: options.instructions },
      tools: options.tools.map((tool) => sdkTool(tool, relay)),
    });
    const toolNames = new Set(options.tools.map((t) => t.name));
    const session = new CopilotAgentSession(sdkSession, relay, this.options.endpoint, toolNames, () => this.sessions.delete(session));
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
