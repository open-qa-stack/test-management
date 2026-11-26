import { AGENT_KEYS, MAX_TEAM_INSTRUCTIONS } from "@open-qa-stack/domain";
import type { Command } from "./command.ts";

/** The words each action of `oqas agents` takes, the action included. */
const TAKEN: Readonly<Record<string, number>> = { instruct: 3, clear: 2, prompt: 2, default: 2, replace: 3, reset: 2 };

/**
 * What `oqas agents` asks for, or why it is refused: the list; the instructions of one agent, given or taken back; its
 * prompt, in force or as the code writes it; a prompt in its place, or its own back.
 */
export function agentsOf(words: readonly string[], ofASession: boolean): Command | string {
  const [action, name, text] = words;
  if (ofASession) return "oqas agents sets what the team asks of the agents: it takes no --brief, --environment nor --follow.";
  if (action === undefined) return { name: "agents", action: "list" };
  if (words.length !== TAKEN[action])
    return "oqas agents takes nothing; instruct then an agent and a text, or clear then an agent; prompt, default or reset then an agent; or replace then an agent and a file.";
  const agent = AGENT_KEYS.find((key) => key === name);
  if (agent === undefined) return `${name} is no agent: name one of ${AGENT_KEYS.join(", ")}.`;
  if (action === "prompt" || action === "default") return { name: "agents", action, agent };
  if (action === "replace") return { name: "agents", action, agent, file: text! };
  if (action === "reset") return { name: "agents", action: "replace", agent };
  if (text === undefined) return { name: "agents", action: "instruct", agent };
  if (text.trim() === "" || text.length > MAX_TEAM_INSTRUCTIONS) return `The instructions of an agent are a text of 1 to ${MAX_TEAM_INSTRUCTIONS} characters.`;
  return { name: "agents", action: "instruct", agent, instructions: text.trim() };
}
