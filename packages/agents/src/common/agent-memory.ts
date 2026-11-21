import type { MemoryStorePort, ResolvedConfig, ToolDefinition } from "@open-qa-stack/domain";
import { memoryTools } from "@open-qa-stack/tools";
import { configSecrets } from "./config-secrets.ts";

/** Who takes notes in a task. */
export interface NoteTaker {
  /** Role of the agent. */
  readonly role: string;
  /** Identifier of the task. */
  readonly task: string;
  /** The clock of the memories. */
  readonly now?: () => Date;
}

/**
 * The tools of a task over the memory of the agents.
 *
 * @remarks
 * Every secret of the configuration (`configSecrets`) is one no memory may hold, in its domain, its text, its
 * tags or its source.
 *
 * @param config - The resolved configuration.
 * @param memory - Where the memories of the agents are kept.
 * @param env - The environment the configuration reads.
 * @param taker - Who takes the notes.
 * @returns The tools `remember` and `recall`.
 */
export function agentMemory(
  config: ResolvedConfig,
  memory: MemoryStorePort,
  env: Readonly<Record<string, string | undefined>>,
  taker: NoteTaker,
): ToolDefinition[] {
  return memoryTools(memory, { ...taker, secrets: configSecrets(config, env) });
}

/**
 * The tool that reads the memory of the agents, for a task that takes no notes.
 *
 * @param config - The resolved configuration.
 * @param memory - Where the memories of the agents are kept.
 * @param env - The environment the configuration reads.
 * @param taker - Who reads the memories.
 * @returns The tool `recall`.
 */
export function agentRecall(
  config: ResolvedConfig,
  memory: MemoryStorePort,
  env: Readonly<Record<string, string | undefined>>,
  taker: NoteTaker,
): ToolDefinition[] {
  return agentMemory(config, memory, env, taker).filter((tool) => tool.name === "recall");
}
