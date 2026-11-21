import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CopilotAgentRuntime, ModelGateway } from "@open-qa-stack/harness";
import { readsImages, type ResolvedConfig } from "@open-qa-stack/domain";
import type { OpenRuntime } from "../ports/open-runtime.ts";

/**
 * Opens the runtime of the agents on the model the configuration names, with a folder of its own for the
 * sessions: through a gateway that forwards to a server with a provider key, or with the GitHub account of the
 * machine for a model of GitHub Copilot; the model reads images when the configuration declares
 * that it does, and reasons as much as the configuration says when it says so.
 *
 * @param config - The resolved configuration.
 * @param env - The environment the key of the model is read from.
 * @returns The runtime, and how to release it: closing stops the runtime and its gateway, and removes the folder of its sessions.
 */
export async function liveRuntime(config: ResolvedConfig, env: Readonly<Record<string, string | undefined>>): Promise<OpenRuntime> {
  const home = await mkdtemp(join(tmpdir(), "oqas-sessions-"));
  const model = config.model;
  const vision = readsImages(model);
  if (model.mode === "github") {
    const effort = model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort };
    const runtime = new CopilotAgentRuntime({ model: model.model, homeDirectory: home, vision, ...effort });
    return { runtime, close: () => closeAll(runtime, undefined, home) };
  }
  const apiKey = model.apiKeyEnv === undefined ? undefined : env[model.apiKeyEnv];
  const { baseUrl, reasoningEffort, requestTimeoutSeconds } = model;
  const upstream = {
    baseUrl,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(requestTimeoutSeconds === undefined ? {} : { timeoutMs: requestTimeoutSeconds * 1000 }),
  };
  const gateway = await ModelGateway.start({ kind: "live", upstream });
  const runtime = new CopilotAgentRuntime({ endpoint: gateway, model: model.model, homeDirectory: home, vision });
  return { runtime, close: () => closeAll(runtime, gateway, home) };
}

/** Stops the runtime, then its gateway when it has one, and removes the folder of its sessions. */
async function closeAll(runtime: CopilotAgentRuntime, gateway: ModelGateway | undefined, home: string): Promise<void> {
  await runtime.close();
  await gateway?.close();
  await rm(home, { recursive: true, force: true });
}
