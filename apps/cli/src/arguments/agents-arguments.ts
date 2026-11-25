import { AGENT_KEYS, MAX_TEAM_INSTRUCTIONS } from "@open-qa-stack/domain";
import type { Command } from "./command.ts";

/** What `oqas agents` asks for, or why it is refused: the list, or the instructions of one agent, given or taken back. */
export function agentsOf(words: readonly string[], ofASession: boolean): Command | string {
  const [action, name, text, ...rest] = words;
  if (ofASession) return "oqas agents sets what the team asks of the agents: it takes no --brief, --environment nor --follow.";
  if (action === undefined) return { name: "agents", action: "list" };
  const taken = action === "instruct" ? 3 : action === "clear" ? 2 : 0;
  if (words.length !== taken || rest.length > 0) return "oqas agents takes nothing, instruct then an agent and a text, or clear then an agent.";
  const agent = AGENT_KEYS.find((key) => key === name);
  if (agent === undefined) return `${name} is no agent: name one of ${AGENT_KEYS.join(", ")}.`;
  if (text === undefined) return { name: "agents", action: "instruct", agent };
  if (text.trim() === "" || text.length > MAX_TEAM_INSTRUCTIONS) return `The instructions of an agent are a text of 1 to ${MAX_TEAM_INSTRUCTIONS} characters.`;
  return { name: "agents", action: "instruct", agent, instructions: text.trim() };
}
