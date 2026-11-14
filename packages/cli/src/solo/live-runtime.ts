import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRuntime } from "@open-qa-stack/domain";
import { CopilotAgentRuntime, ModelGateway } from "@open-qa-stack/harness";
import { readsImages, type ResolvedConfig } from "@open-qa-stack/shared";

/** A runtime of the agents, and how to release it. */
export interface OpenRuntime {
  readonly runtime: AgentRuntime;
  /** Stops the runtime and its gateway, and removes the folder of its sessions. */
  close(): Promise<void>;
}

/**
 * Opens the runtime of the agents on the model the configuration names, through a gateway that forwards
 * to it, with a folder of its own for the sessions; the model reads images when the configuration declares
 * that it does, and reasons as much as the configuration says when it says so.
 *
 * @param config - The resolved configuration.
 * @param env - The environment the key of the model is read from.
 * @returns The runtime, and how to release it.
 */
export async function liveRuntime(config: ResolvedConfig, env: Readonly<Record<string, string | undefined>>): Promise<OpenRuntime> {
  const apiKey = config.model.apiKeyEnv === undefined ? undefined : env[config.model.apiKeyEnv];
  const { baseUrl, reasoningEffort, requestTimeoutSeconds } = config.model;
  const upstream = {
    baseUrl,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(requestTimeoutSeconds === undefined ? {} : { timeoutMs: requestTimeoutSeconds * 1000 }),
  };
  const gateway = await ModelGateway.start({ kind: "live", upstream });
  const home = await mkdtemp(join(tmpdir(), "oqas-sessions-"));
  const runtime = new CopilotAgentRuntime({ endpoint: gateway, model: config.model.model, homeDirectory: home, vision: readsImages(config.model) });
  return {
    runtime,
    close: async () => {
      await runtime.close();
      await gateway.close();
      await rm(home, { recursive: true, force: true });
    },
  };
}
