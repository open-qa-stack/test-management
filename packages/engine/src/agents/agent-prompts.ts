import { AGENT_PROMPTS } from "@open-qa-stack/agents";
import { AGENT_KEYS, type AgentPrompt } from "@open-qa-stack/domain";
import { textDigest } from "./text-digest.ts";

/**
 * The prompts of the agents as the code writes them: what a team reads before it writes a prompt of its own in place
 * of one, and what tells it the prompt it replaced has changed since.
 */
export class AgentPrompts {
  /** @returns The prompt of each agent, in the order the agents work. */
  list(): AgentPrompt[] {
    return AGENT_KEYS.map((agent) => {
      const { template, variables } = AGENT_PROMPTS[agent];
      return { agent, template, variables, digest: textDigest(template) };
    });
  }
}
