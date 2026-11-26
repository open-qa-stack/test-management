import { AGENT_PROMPTS, promptOf } from "@open-qa-stack/agents";
import {
  replacedPrompt,
  teamInstructions,
  type AgentKey,
  type AgentRuntime,
  type AgentSession,
  type AgentsSettings,
  type SessionOptions,
} from "@open-qa-stack/domain";
import { textDigest } from "../agents/text-digest.ts";

/** What stands before the instructions of the team, at the end of the prompt of an agent. */
export const TEAM_TITLE = "Instructions of the team:";

/** What the team gives an agent: a prompt in place of its own, or instructions at the end of it. */
export type TeamPart = "prompt" | "instructions";

/**
 * A runtime of the agents whose sessions follow what the team asks of their agent: a prompt the team wrote stands in
 * place of that of the agent, what the harness adds after it kept; the instructions of the team end them, under a title.
 */
export class TeamRuntime implements AgentRuntime {
  private readonly inner: AgentRuntime;
  private readonly agents: AgentsSettings;
  private readonly given: (agent: AgentKey, part: TeamPart, digest: string) => void;

  /**
   * @param inner - The runtime the sessions are opened on.
   * @param agents - What the configuration says of the agents.
   * @param given - Told each part the team gives an agent, with the first characters of its SHA-256.
   */
  public constructor(inner: AgentRuntime, agents: AgentsSettings, given: (agent: AgentKey, part: TeamPart, digest: string) => void) {
    this.inner = inner;
    this.agents = agents;
    this.given = given;
  }

  /**
   * {@inheritDoc @open-qa-stack/domain#AgentRuntime.openSession}
   *
   * @throws Error when the team replaced the prompt of an agent whose session does not start with it: a fault of the
   * harness, not of the team.
   */
  public async openSession(options: SessionOptions): Promise<AgentSession> {
    const { agent } = options;
    if (agent === undefined) return this.inner.openSession(options);
    const replaced = replacedPrompt(this.agents, agent);
    const asked = teamInstructions(this.agents, agent);
    let instructions = options.instructions;
    if (replaced !== undefined) {
      const prompt = AGENT_PROMPTS[agent];
      const values = options.values ?? {};
      const own = promptOf(prompt, values);
      if (!instructions.startsWith(own))
        throw new Error(`The session of the ${agent} does not start with its prompt: the prompt of the team cannot stand in its place.`);
      instructions = `${promptOf({ ...prompt, template: replaced.text }, values)}${instructions.slice(own.length)}`;
      this.given(agent, "prompt", textDigest(replaced.text).slice(0, 12));
    }
    if (asked !== undefined) {
      instructions = `${instructions}\n\n${TEAM_TITLE}\n\n${asked}`;
      this.given(agent, "instructions", textDigest(asked).slice(0, 12));
    }
    return this.inner.openSession({ ...options, instructions });
  }

  /** {@inheritDoc @open-qa-stack/domain#AgentRuntime.close} */
  public close(): Promise<void> {
    return this.inner.close();
  }
}
