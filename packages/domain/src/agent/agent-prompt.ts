import type { AgentKey } from "./agent-key.ts";
import type { AgentsSettings } from "./team-instructions.ts";

/** Longest prompt a team writes in place of that of an agent, in characters. */
export const MAX_REPLACED_PROMPT = 40000;

/** The prompt of an agent as the code writes it: what each of its sessions starts with, unless the team replaces it. */
export interface AgentPrompt {
  /** The agent. */
  readonly agent: AgentKey;
  /** Its text, with a `{{name}}` wherever a variable goes. */
  readonly template: string;
  /** The names of its variables, each what the harness writes there in a session, such as the name of a tool. */
  readonly variables: readonly string[];
  /** The SHA-256 of its text, in hexadecimal: a prompt replaced on another digest was written on a former prompt. */
  readonly digest: string;
}

/** The prompts of the agents, as a client reads them. */
export interface AgentPromptList {
  /** The prompt of each agent, in the order the agents work. */
  readonly items: readonly AgentPrompt[];
}

/** A prompt the team writes in place of that of an agent. */
export interface ReplacedPrompt {
  /** Its text, where `{{name}}` stands for a variable of the prompt it replaces. */
  text: string;
  /** The digest of the prompt it replaced, when it was written. */
  basedOn: string;
}

/**
 * The prompt a team writes in place of that of an agent.
 *
 * @param agents - What the configuration says of the agents.
 * @param agent - The agent.
 * @returns The prompt; `undefined` when the agent keeps its own.
 */
export function replacedPrompt(agents: AgentsSettings | undefined, agent: AgentKey): ReplacedPrompt | undefined {
  const prompt = agents?.[agent]?.prompt;
  return prompt?.text.trim() === "" ? undefined : prompt;
}

/**
 * What a prompt written in place of another leaves out: the variables of the one it replaces it does not write.
 *
 * @param text - The prompt written.
 * @param variables - The variables of the prompt it replaces.
 * @returns Their names, in the order given.
 */
export function missingVariables(text: string, variables: readonly string[]): string[] {
  return variables.filter((name) => !text.includes(`{{${name}}}`));
}
