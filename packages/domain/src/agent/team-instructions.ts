import type { AgentKey } from "./agent-key.ts";
import type { ReplacedPrompt } from "./agent-prompt.ts";

/** Longest instructions of the team for one agent, in characters. */
export const MAX_TEAM_INSTRUCTIONS = 4000;

/** What a team asks of one agent. */
export interface AgentSettings {
  /** What is added at the end of its prompt. */
  instructions?: string;
  /** What the team writes in place of its prompt; it keeps its own when left out. */
  prompt?: ReplacedPrompt;
}

/** What a team asks of the agents it has something to ask of. */
export type AgentsSettings = Partial<Record<AgentKey, AgentSettings>>;

/**
 * What a team asks of an agent.
 *
 * @param agents - What the configuration says of the agents.
 * @param agent - The agent.
 * @returns Its instructions, without the spaces around them; `undefined` when there are none.
 */
export function teamInstructions(agents: AgentsSettings | undefined, agent: AgentKey): string | undefined {
  const text = agents?.[agent]?.instructions?.trim();
  return text === "" ? undefined : text;
}
