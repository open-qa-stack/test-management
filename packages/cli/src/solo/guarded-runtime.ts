import type { AgentRuntime, AgentSession, SessionOptions } from "@open-qa-stack/domain";

/**
 * A runtime of the agents whose sessions all stop at a deadline: the guardrail of a run.
 *
 * @remarks
 * Each session opened gets, as its duration limit, the shorter of its own and the time left until the
 * deadline; a task the guardrail stops is stopped by its duration limit, at its next call to the model or
 * to a tool. What runs outside the sessions is not bounded.
 */
export class GuardedRuntime implements AgentRuntime {
  private readonly inner: AgentRuntime;
  private readonly deadline: number;
  private readonly now: () => number;

  /**
   * @param inner - The runtime the sessions are opened on.
   * @param deadline - When every session stops, in milliseconds since the epoch.
   * @param now - The clock, in milliseconds since the epoch.
   */
  public constructor(inner: AgentRuntime, deadline: number, now: () => number) {
    this.inner = inner;
    this.deadline = deadline;
    this.now = now;
  }

  /** {@inheritDoc @open-qa-stack/domain#AgentRuntime.openSession} */
  public openSession(options: SessionOptions): Promise<AgentSession> {
    const left = Math.max(0, this.deadline - this.now());
    const { maxIterations = null, maxDurationMs = null, maxActions = null } = options.limits ?? {};
    return this.inner.openSession({
      ...options,
      limits: { maxIterations, maxActions, maxDurationMs: maxDurationMs === null ? left : Math.min(maxDurationMs, left) },
    });
  }

  /** {@inheritDoc @open-qa-stack/domain#AgentRuntime.close} */
  public close(): Promise<void> {
    return this.inner.close();
  }
}
