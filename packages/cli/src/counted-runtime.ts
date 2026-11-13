import type { AgentEvent, AgentRuntime, AgentSession, SessionOptions } from "@open-qa-stack/domain";

/**
 * A runtime of the agents that counts the requests its sessions send to the model, as their counters give
 * them, whatever the end of the task that opened them.
 *
 * @remarks
 * A session gives its counters at the end of each turn: the requests of a turn cut short before its end,
 * by an error of the role that reads it, are not counted.
 */
export class CountedRuntime implements AgentRuntime {
  private readonly inner: AgentRuntime;
  /** The iterations of each session opened, as its last counters gave them. */
  private readonly sessions: number[] = [];

  /** @param inner - The runtime the sessions are opened on. */
  public constructor(inner: AgentRuntime) {
    this.inner = inner;
  }

  /** How many requests the sessions opened so far sent to the model. */
  public get modelRequests(): number {
    return this.sessions.reduce((total, iterations) => total + iterations, 0);
  }

  /** {@inheritDoc @open-qa-stack/domain#AgentRuntime.openSession} */
  public async openSession(options: SessionOptions): Promise<AgentSession> {
    const session = await this.inner.openSession(options);
    const at = this.sessions.push(0) - 1;
    const sessions = this.sessions;
    return {
      async *send(message: string): AsyncIterable<AgentEvent> {
        for await (const event of session.send(message)) {
          // The counters of a session add up over its turns: the last ones count.
          const counters = event.type === "stopped" ? event.reason.counters : event.type === "end" || event.type === "error" ? event.counters : undefined;
          if (counters !== undefined) sessions[at] = counters.iterations;
          yield event;
        }
      },
      close: () => session.close(),
    };
  }

  /** {@inheritDoc @open-qa-stack/domain#AgentRuntime.close} */
  public close(): Promise<void> {
    return this.inner.close();
  }
}
