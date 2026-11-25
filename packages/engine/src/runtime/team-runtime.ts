import { createHash } from "node:crypto";
import { teamInstructions, type AgentKey, type AgentRuntime, type AgentSession, type AgentsSettings, type SessionOptions } from "@open-qa-stack/domain";

/** What stands before the instructions of the team, at the end of the prompt of an agent. */
export const TEAM_TITLE = "Instructions of the team:";

/**
 * A runtime of the agents whose sessions follow what the team asks of their agent: the instructions of each session it
 * opens end with those of the team for that agent, under a title. The prompt of the agent stays as it is.
 */
export class TeamRuntime implements AgentRuntime {
  private readonly inner: AgentRuntime;
  private readonly agents: AgentsSettings;
  private readonly given: (agent: AgentKey, digest: string) => void;

  /**
   * @param inner - The runtime the sessions are opened on.
   * @param agents - What the configuration says of the agents.
   * @param given - Told each agent given instructions, with the first characters of their SHA-256.
   */
  public constructor(inner: AgentRuntime, agents: AgentsSettings, given: (agent: AgentKey, digest: string) => void) {
    this.inner = inner;
    this.agents = agents;
    this.given = given;
  }

  /** {@inheritDoc @open-qa-stack/domain#AgentRuntime.openSession} */
  public openSession(options: SessionOptions): Promise<AgentSession> {
    const { agent } = options;
    const asked = agent === undefined ? undefined : teamInstructions(this.agents, agent);
    if (agent === undefined || asked === undefined) return this.inner.openSession(options);
    this.given(agent, createHash("sha256").update(asked).digest("hex").slice(0, 12));
    return this.inner.openSession({ ...options, instructions: `${options.instructions}\n\n${TEAM_TITLE}\n\n${asked}` });
  }

  /** {@inheritDoc @open-qa-stack/domain#AgentRuntime.close} */
  public close(): Promise<void> {
    return this.inner.close();
  }
}
